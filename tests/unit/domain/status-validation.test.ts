// tests/unit/domain/status-validation.test.ts
// ステータス計算ロジックのユニットテスト（#0255 XP/レベル統一後）

import { describe, expect, it } from 'vitest';
import {
	calcActivitiesToNextLevel,
	calcCharacterType,
	calcDecay,
	calcDeviationScore,
	calcLevelFromXp,
	calcStars,
	calcTrend,
	calcXpToNextLevel,
	clampDecayFloor,
	DECAY_GRACE_DAYS,
	getAgeCoefficient,
	getComparisonLabel,
	getLevelEvaluationText,
	LEVEL_EVALUATION_TIERS,
	LEVEL_TABLE,
} from '../../../src/lib/domain/validation/status';

// ================================================================
// LEVEL_TABLE
// ================================================================

describe('LEVEL_TABLE', () => {
	it('99段階定義されている', () => {
		expect(LEVEL_TABLE.length).toBe(99);
	});

	it('レベル1から99まで連続', () => {
		for (let i = 0; i < 99; i++) {
			expect(LEVEL_TABLE[i]?.level).toBe(i + 1);
		}
	});

	it('必要XPは厳密に単調増加', () => {
		for (let i = 1; i < LEVEL_TABLE.length; i++) {
			expect(LEVEL_TABLE[i]?.requiredXp).toBeGreaterThan(LEVEL_TABLE[i - 1]?.requiredXp ?? 0);
		}
	});

	it('Lv.1の必要XPは0', () => {
		expect(LEVEL_TABLE[0]?.requiredXp).toBe(0);
	});

	it('キーポイントが設計通り', () => {
		expect(LEVEL_TABLE[1]?.requiredXp).toBe(15); // Lv.2
		expect(LEVEL_TABLE[2]?.requiredXp).toBe(40); // Lv.3
		expect(LEVEL_TABLE[3]?.requiredXp).toBe(80); // Lv.4
		expect(LEVEL_TABLE[4]?.requiredXp).toBe(140); // Lv.5
		expect(LEVEL_TABLE[9]?.requiredXp).toBe(500); // Lv.10
		expect(LEVEL_TABLE[19]?.requiredXp).toBe(2500); // Lv.20
		expect(LEVEL_TABLE[98]?.requiredXp).toBe(100000); // Lv.99
	});

	it('全エントリにタイトルがある', () => {
		for (const entry of LEVEL_TABLE) {
			expect(entry.title).toBeTypeOf('string');
			expect(entry.title.length).toBeGreaterThan(0);
		}
	});

	it('Lv.1-10は固有タイトル', () => {
		expect(LEVEL_TABLE[0]?.title).toBe('はじめのぼうけんしゃ');
		expect(LEVEL_TABLE[4]?.title).toBe('きらきらヒーロー');
		expect(LEVEL_TABLE[9]?.title).toBe('かみさまレベル');
	});

	it('Lv.99は最高タイトル', () => {
		expect(LEVEL_TABLE[98]?.title).toBe('でんせつのぼうけんしゃ');
	});
});

// ================================================================
// calcLevelFromXp
// ================================================================

describe('calcLevelFromXp', () => {
	it('0 XPはレベル1', () => {
		expect(calcLevelFromXp(0)).toEqual({ level: 1, title: 'はじめのぼうけんしゃ' });
	});

	it('14 XPはレベル1（Lv.2の手前）', () => {
		expect(calcLevelFromXp(14).level).toBe(1);
	});

	it('15 XPはレベル2', () => {
		expect(calcLevelFromXp(15)).toEqual({ level: 2, title: 'がんばりルーキー' });
	});

	it('39 XPはレベル2', () => {
		expect(calcLevelFromXp(39).level).toBe(2);
	});

	it('40 XPはレベル3', () => {
		expect(calcLevelFromXp(40).level).toBe(3);
	});

	it('500 XPはレベル10', () => {
		expect(calcLevelFromXp(500).level).toBe(10);
	});

	it('100000 XPはレベル99', () => {
		expect(calcLevelFromXp(100000).level).toBe(99);
	});

	it('100001 XPもレベル99（上限）', () => {
		expect(calcLevelFromXp(100001).level).toBe(99);
	});

	it('負の値はレベル1', () => {
		expect(calcLevelFromXp(-100).level).toBe(1);
	});

	it('境界値: 各レベルのrequiredXpで正しいレベルが返る', () => {
		for (const entry of LEVEL_TABLE) {
			const result = calcLevelFromXp(entry.requiredXp);
			expect(result.level).toBe(entry.level);
		}
	});
});

// ================================================================
// calcXpToNextLevel
// ================================================================

describe('calcXpToNextLevel', () => {
	it('0 XP (Lv.1) → 次まで15XP', () => {
		const result = calcXpToNextLevel(0);
		expect(result.currentLevel).toBe(1);
		expect(result.xpNeeded).toBe(15);
		expect(result.progressPct).toBe(0);
	});

	it('7 XP (Lv.1) → 進捗約47%', () => {
		const result = calcXpToNextLevel(7);
		expect(result.currentLevel).toBe(1);
		expect(result.xpNeeded).toBe(8);
		expect(result.xpInCurrentLevel).toBe(7);
		expect(result.xpForCurrentLevel).toBe(15);
		expect(result.progressPct).toBeCloseTo(46.7, 0);
	});

	it('15 XP (Lv.2) → 次まで25XP', () => {
		const result = calcXpToNextLevel(15);
		expect(result.currentLevel).toBe(2);
		expect(result.xpNeeded).toBe(25);
		expect(result.progressPct).toBe(0);
	});

	it('500 XP (Lv.10) の進捗率', () => {
		const result = calcXpToNextLevel(500);
		expect(result.currentLevel).toBe(10);
		expect(result.xpNeeded).toBeGreaterThan(0);
	});

	it('Lv.99 (100000 XP) は進捗100%、必要XP=0', () => {
		const result = calcXpToNextLevel(100000);
		expect(result.currentLevel).toBe(99);
		expect(result.xpNeeded).toBe(0);
		expect(result.progressPct).toBe(100);
	});

	it('Lv.99超 (150000 XP) も進捗100%', () => {
		const result = calcXpToNextLevel(150000);
		expect(result.currentLevel).toBe(99);
		expect(result.xpNeeded).toBe(0);
		expect(result.progressPct).toBe(100);
	});
});

// ================================================================
// calcActivitiesToNextLevel
// ================================================================

describe('calcActivitiesToNextLevel', () => {
	it('0 XP、平均5ポイント → Lv.2まで3回', () => {
		expect(calcActivitiesToNextLevel(0, 5)).toBe(3);
	});

	it('0 XP、平均8ポイント → Lv.2まで2回', () => {
		expect(calcActivitiesToNextLevel(0, 8)).toBe(2);
	});

	it('Lv.99なら0回', () => {
		expect(calcActivitiesToNextLevel(100000, 5)).toBe(0);
	});

	it('デフォルト平均ポイントは8', () => {
		const result = calcActivitiesToNextLevel(0);
		expect(result).toBe(Math.ceil(15 / 8));
	});
});

// ================================================================
// getLevelEvaluationText
// ================================================================

describe('LEVEL_EVALUATION_TIERS', () => {
	it('終端（minLevel: 0）が存在する', () => {
		const terminator = LEVEL_EVALUATION_TIERS.find((t) => t.minLevel === 0);
		expect(terminator).toBeDefined();
	});

	it('minLevel が降順にソートされている', () => {
		for (let i = 1; i < LEVEL_EVALUATION_TIERS.length; i++) {
			const prev = LEVEL_EVALUATION_TIERS[i - 1];
			const curr = LEVEL_EVALUATION_TIERS[i];
			expect(prev?.minLevel).toBeGreaterThan(curr?.minLevel ?? 0);
		}
	});

	it('全エントリに text と emoji がある', () => {
		for (const tier of LEVEL_EVALUATION_TIERS) {
			expect(tier.text.length).toBeGreaterThan(0);
			expect(tier.emoji.length).toBeGreaterThan(0);
		}
	});
});

describe('getLevelEvaluationText', () => {
	it('Lv.1は「はじめのいっぽ」', () => {
		const result = getLevelEvaluationText(1);
		expect(result.text).toBe('はじめのいっぽ！');
		expect(result.emoji).toBe('🌱');
	});

	it('Lv.2は「そのちょうしだ」', () => {
		expect(getLevelEvaluationText(2).text).toBe('そのちょうしだ！');
	});

	it('Lv.5は「すごいぞ」', () => {
		expect(getLevelEvaluationText(5).text).toBe('すごいぞ！');
	});

	it('Lv.10は「めちゃくちゃがんばってる」', () => {
		expect(getLevelEvaluationText(10).text).toBe('めちゃくちゃがんばってる！');
	});

	it('Lv.50は「でんせつのぼうけんしゃ」', () => {
		expect(getLevelEvaluationText(50).text).toBe('でんせつのぼうけんしゃ！');
	});

	// 境界値テスト（AC 要件: level -1, 0, 1, 2, 3, 4, 5, 6, 7, 10, 20, 30, 50, 100）
	it.each([
		{ level: -1, expectedText: 'はじめのいっぽ！', expectedEmoji: '🌱' },
		{ level: 0, expectedText: 'はじめのいっぽ！', expectedEmoji: '🌱' },
		{ level: 1, expectedText: 'はじめのいっぽ！', expectedEmoji: '🌱' },
		{ level: 2, expectedText: 'そのちょうしだ！', expectedEmoji: '💪' },
		{ level: 3, expectedText: 'いいかんじ！', expectedEmoji: '😊' },
		{ level: 4, expectedText: 'いいかんじ！', expectedEmoji: '😊' },
		{ level: 5, expectedText: 'すごいぞ！', expectedEmoji: '✨' },
		{ level: 6, expectedText: 'すごいぞ！', expectedEmoji: '✨' },
		{ level: 7, expectedText: 'たつじんレベル！', expectedEmoji: '⭐' },
		{ level: 10, expectedText: 'めちゃくちゃがんばってる！', expectedEmoji: '🔥' },
		{ level: 20, expectedText: 'すばらしいせいちょう！', expectedEmoji: '🌟' },
		{ level: 30, expectedText: 'もはやたつじん！', expectedEmoji: '🏆' },
		{ level: 50, expectedText: 'でんせつのぼうけんしゃ！', expectedEmoji: '👑' },
		{ level: 100, expectedText: 'でんせつのぼうけんしゃ！', expectedEmoji: '👑' },
	])('level=$level → "$expectedText"', ({ level, expectedText, expectedEmoji }) => {
		const result = getLevelEvaluationText(level);
		expect(result.text).toBe(expectedText);
		expect(result.emoji).toBe(expectedEmoji);
	});
});

// ================================================================
// calcDeviationScore (unchanged)
// ================================================================

describe('calcDeviationScore', () => {
	it('平均値なら偏差値50', () => {
		expect(calcDeviationScore(50, 50, 10)).toBe(50);
	});

	it('平均+1σなら偏差値60', () => {
		expect(calcDeviationScore(60, 50, 10)).toBe(60);
	});

	it('平均-1σなら偏差値40', () => {
		expect(calcDeviationScore(40, 50, 10)).toBe(40);
	});

	it('標準偏差0なら偏差値50（ゼロ除算回避）', () => {
		expect(calcDeviationScore(70, 50, 0)).toBe(50);
	});
});

// ================================================================
// calcStars (updated: benchmark ratio-based)
// ================================================================

describe('calcStars', () => {
	it('ベンチマーク平均の1.6倍以上で5星', () => {
		expect(calcStars(160, 100)).toBe(5);
		expect(calcStars(200, 100)).toBe(5);
	});

	it('ベンチマーク平均の1.2-1.59倍で4星', () => {
		expect(calcStars(120, 100)).toBe(4);
		expect(calcStars(159, 100)).toBe(4);
	});

	it('ベンチマーク平均の0.8-1.19倍で3星', () => {
		expect(calcStars(80, 100)).toBe(3);
		expect(calcStars(100, 100)).toBe(3);
	});

	it('ベンチマーク平均の0.4-0.79倍で2星', () => {
		expect(calcStars(40, 100)).toBe(2);
		expect(calcStars(79, 100)).toBe(2);
	});

	it('ベンチマーク平均の0.4倍未満で1星', () => {
		expect(calcStars(39, 100)).toBe(1);
		expect(calcStars(0, 100)).toBe(1);
	});

	it('ベンチマーク平均が0以下なら3星', () => {
		expect(calcStars(50, 0)).toBe(3);
		expect(calcStars(50, -10)).toBe(3);
	});
});

// ================================================================
// calcCharacterType (unchanged)
// ================================================================

describe('calcCharacterType', () => {
	it('偏差値55以上でhero', () => {
		expect(calcCharacterType(55)).toBe('hero');
		expect(calcCharacterType(60)).toBe('hero');
	});

	it('偏差値45-54でnormal', () => {
		expect(calcCharacterType(45)).toBe('normal');
		expect(calcCharacterType(54)).toBe('normal');
	});

	it('偏差値44以下でganbari', () => {
		expect(calcCharacterType(44)).toBe('ganbari');
		expect(calcCharacterType(30)).toBe('ganbari');
	});
});

// ================================================================
// getAgeCoefficient (unchanged)
// ================================================================

describe('getAgeCoefficient', () => {
	it('0-6歳は0.3', () => {
		expect(getAgeCoefficient(1)).toBe(0.3);
		expect(getAgeCoefficient(4)).toBe(0.3);
		expect(getAgeCoefficient(6)).toBe(0.3);
	});

	it('7-12歳は0.5', () => {
		expect(getAgeCoefficient(7)).toBe(0.5);
		expect(getAgeCoefficient(12)).toBe(0.5);
	});

	it('13-18歳は0.7', () => {
		expect(getAgeCoefficient(13)).toBe(0.7);
		expect(getAgeCoefficient(18)).toBe(0.7);
	});

	it('19歳以上は0.9', () => {
		expect(getAgeCoefficient(19)).toBe(0.9);
		expect(getAgeCoefficient(20)).toBe(0.9);
	});
});

// ================================================================
// calcDecay (新XPスケール: 整数返却)
// ================================================================

describe('calcDecay', () => {
	it('猶予期間（2日以内）は減少なし', () => {
		expect(calcDecay(0, 4)).toBe(0);
		expect(calcDecay(1, 4)).toBe(0);
		expect(calcDecay(2, 4)).toBe(0);
	});

	it('3日目から減少開始（4歳、normal）: 整数XPが返る', () => {
		const result = calcDecay(3, 4, 'normal');
		expect(Number.isInteger(result)).toBe(true);
		expect(result).toBeGreaterThan(0);
	});

	it('5日未活動（4歳、normal）は3日目より大きい', () => {
		const day3 = calcDecay(3, 4, 'normal');
		const day5 = calcDecay(5, 4, 'normal');
		expect(day5).toBeGreaterThan(day3);
	});

	it('年齢が高いほど減衰が大きい', () => {
		const young = calcDecay(5, 4, 'normal');
		const old = calcDecay(5, 15, 'normal');
		expect(old).toBeGreaterThan(young);
	});

	it('強度 none は常に0', () => {
		expect(calcDecay(10, 4, 'none')).toBe(0);
		expect(calcDecay(100, 15, 'none')).toBe(0);
	});

	it('強度 strict は gentle より大きい（整数丸めで厳密3倍にはならない）', () => {
		const gentle = calcDecay(5, 8, 'gentle');
		const strict = calcDecay(5, 8, 'strict');
		// 乗数比: strict(1.5) / gentle(0.5) = 3 だが Math.round で誤差あり
		expect(strict).toBeGreaterThan(gentle);
		expect(strict).toBeGreaterThanOrEqual(gentle * 2);
	});

	it('デフォルト強度は normal', () => {
		expect(calcDecay(5, 4)).toBe(calcDecay(5, 4, 'normal'));
	});

	it('猶予日数定数が2', () => {
		expect(DECAY_GRACE_DAYS).toBe(2);
	});
});

// ================================================================
// clampDecayFloor (unchanged logic, integer values)
// ================================================================

describe('clampDecayFloor', () => {
	it('減少後が下限（70%）以上ならそのまま', () => {
		expect(clampDecayFloor(1000, 100, 1000)).toBe(900);
	});

	it('減少後が下限を下回る場合は下限で止まる', () => {
		expect(clampDecayFloor(750, 100, 1000)).toBe(700);
	});

	it('既に下限以下の場合は下限を維持', () => {
		expect(clampDecayFloor(600, 50, 1000)).toBe(700);
	});
});

// ================================================================
// calcTrend (新XPスケール: 閾値変更)
// ================================================================

describe('calcTrend', () => {
	it('大きい正の変化はup', () => {
		expect(calcTrend(10)).toBe('up');
		expect(calcTrend(5)).toBe('up');
	});

	it('大きい負の変化はdown', () => {
		expect(calcTrend(-10)).toBe('down');
		expect(calcTrend(-5)).toBe('down');
	});

	it('小さい変化はstable', () => {
		expect(calcTrend(2)).toBe('stable');
		expect(calcTrend(-2)).toBe('stable');
		expect(calcTrend(0)).toBe('stable');
	});
});

// ================================================================
// getComparisonLabel (unchanged)
// ================================================================

describe('getComparisonLabel', () => {
	it('偏差値65以上は最高ラベル', () => {
		const result = getComparisonLabel(65);
		expect(result.text).toBe('みんなよりすっごくすごい！');
		expect(result.emoji).toBe('🌟');
	});

	it('偏差値58-64はすごいラベル', () => {
		expect(getComparisonLabel(58).text).toBe('みんなよりすごい！');
		expect(getComparisonLabel(64).text).toBe('みんなよりすごい！');
	});

	it('偏差値50-57は平均ラベル', () => {
		expect(getComparisonLabel(50).text).toBe('みんなとおなじくらい');
		expect(getComparisonLabel(57).text).toBe('みんなとおなじくらい');
	});

	it('偏差値42-49は励ましラベル', () => {
		expect(getComparisonLabel(42).text).toBe('もうちょっとがんばろう！');
		expect(getComparisonLabel(49).text).toBe('もうちょっとがんばろう！');
	});

	it('偏差値41以下は応援ラベル', () => {
		expect(getComparisonLabel(41).text).toBe('いっしょにがんばろう！');
		expect(getComparisonLabel(30).emoji).toBe('🌱');
	});
});
