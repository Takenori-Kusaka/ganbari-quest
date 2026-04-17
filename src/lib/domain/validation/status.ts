import { z } from 'zod';

// ================================================================
// Level Table (Lv.1–99)
// RPG-style progressive curve: early levels are fast, late levels are slow
// Lv.2 = 15 XP (~3 activities), Lv.10 = 500 XP, Lv.99 = 100,000 XP
// ================================================================

interface LevelEntry {
	readonly level: number;
	readonly requiredXp: number;
	readonly title: string;
}

function generateLevelTable(): readonly LevelEntry[] {
	const titles: Record<number, string> = {
		1: 'はじめのぼうけんしゃ',
		2: 'がんばりルーキー',
		3: 'わくわくファイター',
		4: 'つよつよチャレンジャー',
		5: 'きらきらヒーロー',
		6: 'すごうでアドベンチャー',
		7: 'そらとぶチャンピオン',
		8: 'きせきのマスター',
		9: 'せかいいちのつわもの',
		10: 'かみさまレベル',
	};

	// Tier-based titles for Lv.11+
	const tierTitles: [number, number, string][] = [
		[11, 20, 'ちゅうけんぼうけんしゃ'],
		[21, 30, 'ベテランせんし'],
		[31, 40, 'エリートヒーロー'],
		[41, 50, 'マスターチャンピオン'],
		[51, 60, 'レジェンドファイター'],
		[61, 70, 'ミスティックセイジ'],
		[71, 80, 'コズミックウォリアー'],
		[81, 90, 'ディバインマスター'],
		[91, 98, 'ユニバーサルキング'],
		[99, 99, 'でんせつのぼうけんしゃ'],
	];

	function getTitle(level: number): string {
		if (titles[level]) return titles[level];
		for (const [min, max, title] of tierTitles) {
			if (level >= min && level <= max) return title;
		}
		return `Lv.${level}`;
	}

	// XP curve: hand-tuned key points with interpolation
	const keyPoints: [number, number][] = [
		[1, 0],
		[2, 15],
		[3, 40],
		[4, 80],
		[5, 140],
		[6, 200],
		[7, 275],
		[8, 360],
		[9, 460],
		[10, 500],
		[15, 1200],
		[20, 2500],
		[25, 3500],
		[30, 5100],
		[35, 7600],
		[40, 11000],
		[45, 15000],
		[50, 17000],
		[55, 20000],
		[60, 25000],
		[65, 31500],
		[70, 39000],
		[75, 46500],
		[80, 55500],
		[85, 69000],
		[90, 86000],
		[95, 96500],
		[99, 100000],
	];

	// Linear interpolation between key points
	function interpolateXp(level: number): number {
		if (level <= 1) return 0;
		for (let i = 0; i < keyPoints.length - 1; i++) {
			const kp = keyPoints[i];
			const kpNext = keyPoints[i + 1];
			if (!kp || !kpNext) continue;
			const [l1, xp1] = kp;
			const [l2, xp2] = kpNext;
			if (level >= l1 && level <= l2) {
				const t = (level - l1) / (l2 - l1);
				return Math.round(xp1 + t * (xp2 - xp1));
			}
		}
		return 100000;
	}

	const table: LevelEntry[] = [];
	for (let lv = 1; lv <= 99; lv++) {
		table.push({
			level: lv,
			requiredXp: interpolateXp(lv),
			title: getTitle(lv),
		});
	}
	return Object.freeze(table);
}

export const LEVEL_TABLE: readonly LevelEntry[] = generateLevelTable();

// ================================================================
// Level Calculation (XP → Level)
// ================================================================

/** 累計XPからレベルとタイトルを算出（二分探索） */
export function calcLevelFromXp(totalXp: number): { level: number; title: string } {
	const xp = Math.max(0, totalXp);
	let lo = 0;
	let hi = LEVEL_TABLE.length - 1;
	// LEVEL_TABLE は 99 要素で必ず存在する
	// biome-ignore lint/style/noNonNullAssertion: LEVEL_TABLE[0] is guaranteed to exist (99 entries)
	let result = LEVEL_TABLE[0]!;

	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		// biome-ignore lint/style/noNonNullAssertion: mid is always within bounds
		const entry = LEVEL_TABLE[mid]!;
		if (entry.requiredXp <= xp) {
			result = entry;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}

	return { level: result.level, title: result.title };
}

/** 次レベルまでの詳細情報を算出 */
export function calcXpToNextLevel(totalXp: number): {
	currentLevel: number;
	xpNeeded: number;
	xpInCurrentLevel: number;
	xpForCurrentLevel: number;
	progressPct: number;
} {
	const xp = Math.max(0, totalXp);
	const { level } = calcLevelFromXp(xp);
	const currentEntry = LEVEL_TABLE[level - 1];
	const nextEntry = level < 99 ? LEVEL_TABLE[level] : null;

	if (!currentEntry || !nextEntry) {
		return {
			currentLevel: level,
			xpNeeded: 0,
			xpInCurrentLevel: 0,
			xpForCurrentLevel: 0,
			progressPct: 100,
		};
	}

	const xpInCurrentLevel = xp - currentEntry.requiredXp;
	const xpForCurrentLevel = nextEntry.requiredXp - currentEntry.requiredXp;
	const xpNeeded = nextEntry.requiredXp - xp;
	const progressPct =
		xpForCurrentLevel > 0
			? Math.min(100, Math.max(0, (xpInCurrentLevel / xpForCurrentLevel) * 100))
			: 100;

	return {
		currentLevel: level,
		xpNeeded: Math.max(0, xpNeeded),
		xpInCurrentLevel,
		xpForCurrentLevel,
		progressPct: Math.round(progressPct * 10) / 10,
	};
}

/** 次レベルまでに必要な活動回数を概算 */
export function calcActivitiesToNextLevel(totalXp: number, avgPointsPerActivity = 8): number {
	const { xpNeeded } = calcXpToNextLevel(totalXp);
	if (xpNeeded <= 0) return 0;
	return Math.ceil(xpNeeded / Math.max(1, avgPointsPerActivity));
}

// ================================================================
// Level-based Evaluation Text (replaces deviation-based for child UI)
// ================================================================

export type LevelEvaluationTier = {
	readonly minLevel: number;
	readonly text: string;
	readonly emoji: string;
};

/** minLevel 降順。配列要素の追加は他要素に影響しない（データ駆動） */
export const LEVEL_EVALUATION_TIERS: readonly LevelEvaluationTier[] = [
	{ minLevel: 50, text: 'でんせつのぼうけんしゃ！', emoji: '👑' },
	{ minLevel: 30, text: 'もはやたつじん！', emoji: '🏆' },
	{ minLevel: 20, text: 'すばらしいせいちょう！', emoji: '🌟' },
	{ minLevel: 10, text: 'めちゃくちゃがんばってる！', emoji: '🔥' },
	{ minLevel: 7, text: 'たつじんレベル！', emoji: '⭐' },
	{ minLevel: 5, text: 'すごいぞ！', emoji: '✨' },
	{ minLevel: 3, text: 'いいかんじ！', emoji: '😊' },
	{ minLevel: 2, text: 'そのちょうしだ！', emoji: '💪' },
	{ minLevel: 0, text: 'はじめのいっぽ！', emoji: '🌱' },
] as const;

/** レベルに連動した評価文（子供画面用） */
export function getLevelEvaluationText(level: number): { text: string; emoji: string } {
	const tier =
		LEVEL_EVALUATION_TIERS.find((t) => level >= t.minLevel) ??
		LEVEL_EVALUATION_TIERS[LEVEL_EVALUATION_TIERS.length - 1];
	if (!tier) throw new Error('LEVEL_EVALUATION_TIERS must include minLevel: 0 terminator');
	return { text: tier.text, emoji: tier.emoji };
}

// ================================================================
// Benchmark / Deviation Score (admin-only, kept for parent analysis)
// ================================================================

/** 偏差値計算: (個人値 - 平均) / 標準偏差 × 10 + 50 */
export function calcDeviationScore(value: number, mean: number, stdDev: number): number {
	if (stdDev === 0) return 50;
	return Math.round(((value - mean) / stdDev) * 10 + 50);
}

/** スコア割合から星評価（5段階） — admin benchmark用 */
export function calcStars(totalXp: number, benchmarkMean: number): number {
	if (benchmarkMean <= 0) return 3;
	const ratio = totalXp / benchmarkMean;
	if (ratio >= 1.6) return 5;
	if (ratio >= 1.2) return 4;
	if (ratio >= 0.8) return 3;
	if (ratio >= 0.4) return 2;
	return 1;
}

/** キャラクター判定 */
export function calcCharacterType(avgDeviationScore: number): string {
	if (avgDeviationScore >= 55) return 'hero';
	if (avgDeviationScore >= 45) return 'normal';
	return 'ganbari';
}

/** 偏差値から比較ラベル（管理画面用） */
export function getComparisonLabel(deviationScore: number): { text: string; emoji: string } {
	if (deviationScore >= 65) return { text: 'みんなよりすっごくすごい！', emoji: '🌟' };
	if (deviationScore >= 58) return { text: 'みんなよりすごい！', emoji: '✨' };
	if (deviationScore >= 50) return { text: 'みんなとおなじくらい', emoji: '😊' };
	if (deviationScore >= 42) return { text: 'もうちょっとがんばろう！', emoji: '💪' };
	return { text: 'いっしょにがんばろう！', emoji: '🌱' };
}

// ================================================================
// Decay System
// ================================================================

/** 年齢係数（ステータス減少用） */
export function getAgeCoefficient(age: number): number {
	if (age <= 6) return 0.3;
	if (age <= 12) return 0.5;
	if (age <= 18) return 0.7;
	return 0.9;
}

/** 減少強度（親が設定画面で選択） */
export type DecayIntensity = 'none' | 'gentle' | 'normal' | 'strict';

/** 強度別の減少係数乗算 */
const DECAY_INTENSITY_MULTIPLIER: Record<DecayIntensity, number> = {
	none: 0,
	gentle: 0.5,
	normal: 1.0,
	strict: 1.5,
};

/** 猶予日数（この日数以内は減少なし） */
export const DECAY_GRACE_DAYS = 2;

/**
 * 新XPスケール用の減衰スケーリング係数
 * 旧: 0.3 XP/活動 → 新: ~8 XP/活動（平均）= 約27倍
 * 減衰も同比率でスケールさせる
 */
const DECAY_SCALE = 27;

/** ステータス減少計算（猶予2日、整数XP返却） */
export function calcDecay(
	daysSinceActivity: number,
	age: number,
	intensity: DecayIntensity = 'normal',
): number {
	if (daysSinceActivity <= DECAY_GRACE_DAYS) return 0;
	if (intensity === 'none') return 0;

	const effectiveDays = daysSinceActivity - DECAY_GRACE_DAYS;
	const coeff = getAgeCoefficient(age);
	const baseDecay = coeff * 0.1;
	const acceleration = 0.03 * Math.max(0, effectiveDays - 1);
	const rawDecay = baseDecay + acceleration;

	return Math.round(rawDecay * DECAY_INTENSITY_MULTIPLIER[intensity] * DECAY_SCALE);
}

/** 減少後の下限値を算出（最高到達XPの70%を下回らない） */
export function clampDecayFloor(currentXp: number, decayAmount: number, peakXp: number): number {
	const floor = Math.round(peakXp * 0.7);
	const afterDecay = currentXp - decayAmount;
	return Math.max(afterDecay, floor);
}

/** トレンド判定（新XPスケール対応） */
export function calcTrend(recentChange: number): 'up' | 'down' | 'stable' {
	if (recentChange > 3) return 'up';
	if (recentChange < -3) return 'down';
	return 'stable';
}

// ================================================================
// Legacy Compatibility (deprecated, will be removed)
// ================================================================

/**
 * @deprecated Use calcLevelFromXp instead. Kept temporarily for migration.
 * 年齢別ステータス最大値テーブル
 */
export const AGE_MAX_TABLE: { age: number; maxValue: number }[] = [
	{ age: 1, maxValue: 50 },
	{ age: 2, maxValue: 100 },
	{ age: 3, maxValue: 200 },
	{ age: 4, maxValue: 350 },
	{ age: 5, maxValue: 500 },
	{ age: 6, maxValue: 800 },
	{ age: 7, maxValue: 1100 },
	{ age: 8, maxValue: 1500 },
	{ age: 9, maxValue: 2000 },
	{ age: 10, maxValue: 2500 },
	{ age: 11, maxValue: 3000 },
	{ age: 12, maxValue: 3500 },
	{ age: 13, maxValue: 4200 },
	{ age: 14, maxValue: 4900 },
	{ age: 15, maxValue: 5600 },
	{ age: 16, maxValue: 6300 },
	{ age: 17, maxValue: 7100 },
	{ age: 18, maxValue: 8000 },
];

/**
 * @deprecated Use calcLevelFromXp instead. Kept temporarily for migration.
 */
export function getMaxForAge(age: number): number {
	const entry = AGE_MAX_TABLE.find((e) => e.age === age);
	if (entry) return entry.maxValue;
	if (age < 1) return AGE_MAX_TABLE[0]?.maxValue ?? 0;
	return AGE_MAX_TABLE[AGE_MAX_TABLE.length - 1]?.maxValue ?? 0;
}

// ================================================================
// Zod Schemas
// ================================================================

/** ステータスクエリスキーマ */
export const statusQuerySchema = z.object({
	childId: z.coerce.number().int().positive(),
});
