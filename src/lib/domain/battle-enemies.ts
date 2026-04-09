/**
 * 敵マスタデータ
 *
 * 10体以上の敵を定義。レアリティ・曜日出現制限・ステータス・報酬を設定。
 * 年齢スケーリングはバトル時に適用されるため、ここでは base 値のみ。
 */

import type { Enemy, EnemyRarity } from './battle-types';

/** 敵マスタデータ一覧 */
export const ENEMIES: readonly Enemy[] = [
	// ── common（出現率高、基本の敵）──────────────────
	{
		id: 1,
		name: 'スライム',
		icon: '🟢',
		rarity: 'common',
		stats: { hp: 40, atk: 8, def: 5, spd: 6, rec: 2 },
		dropPoints: 10,
		consolationPoints: 3,
		availableDays: [],
	},
	{
		id: 2,
		name: 'コウモリ',
		icon: '🦇',
		rarity: 'common',
		stats: { hp: 30, atk: 10, def: 4, spd: 12, rec: 1 },
		dropPoints: 10,
		consolationPoints: 3,
		availableDays: [],
	},
	{
		id: 3,
		name: 'キノコおばけ',
		icon: '🍄',
		rarity: 'common',
		stats: { hp: 50, atk: 6, def: 8, spd: 4, rec: 3 },
		dropPoints: 10,
		consolationPoints: 3,
		availableDays: [],
	},
	{
		id: 4,
		name: 'ネズミぞく',
		icon: '🐭',
		rarity: 'common',
		stats: { hp: 25, atk: 7, def: 3, spd: 14, rec: 1 },
		dropPoints: 10,
		consolationPoints: 3,
		availableDays: [],
	},

	// ── uncommon（やや強い、曜日限定あり）────────────────
	{
		id: 5,
		name: 'ゴブリン',
		icon: '👹',
		rarity: 'uncommon',
		stats: { hp: 60, atk: 14, def: 8, spd: 8, rec: 3 },
		dropPoints: 20,
		consolationPoints: 5,
		availableDays: [1, 3, 5], // 月・水・金
	},
	{
		id: 6,
		name: 'オオカミ',
		icon: '🐺',
		rarity: 'uncommon',
		stats: { hp: 55, atk: 16, def: 6, spd: 10, rec: 2 },
		dropPoints: 20,
		consolationPoints: 5,
		availableDays: [2, 4, 6], // 火・木・土
	},
	{
		id: 7,
		name: 'いしのゴーレム',
		icon: '🪨',
		rarity: 'uncommon',
		stats: { hp: 80, atk: 10, def: 18, spd: 3, rec: 4 },
		dropPoints: 20,
		consolationPoints: 5,
		availableDays: [0, 6], // 日・土
	},
	{
		id: 8,
		name: 'まほうつかい',
		icon: '🧙',
		rarity: 'uncommon',
		stats: { hp: 45, atk: 18, def: 5, spd: 9, rec: 5 },
		dropPoints: 20,
		consolationPoints: 5,
		availableDays: [1, 2, 3, 4, 5], // 平日
	},

	// ── rare（強い、週末限定）──────────────────────
	{
		id: 9,
		name: 'ドラゴンのこども',
		icon: '🐲',
		rarity: 'rare',
		stats: { hp: 100, atk: 20, def: 14, spd: 10, rec: 6 },
		dropPoints: 40,
		consolationPoints: 10,
		availableDays: [0, 6], // 日・土
	},
	{
		id: 10,
		name: 'やみのきし',
		icon: '⚔️',
		rarity: 'rare',
		stats: { hp: 90, atk: 22, def: 16, spd: 8, rec: 4 },
		dropPoints: 40,
		consolationPoints: 10,
		availableDays: [5, 6], // 金・土
	},

	// ── boss（非常に強い、特定曜日のみ）──────────────────
	{
		id: 11,
		name: 'まおうのかげ',
		icon: '👿',
		rarity: 'boss',
		stats: { hp: 150, atk: 25, def: 18, spd: 12, rec: 8 },
		dropPoints: 80,
		consolationPoints: 15,
		availableDays: [0], // 日曜のみ
	},
	{
		id: 12,
		name: 'こおりのまじょ',
		icon: '🧊',
		rarity: 'boss',
		stats: { hp: 120, atk: 28, def: 12, spd: 14, rec: 10 },
		dropPoints: 80,
		consolationPoints: 15,
		availableDays: [3], // 水曜のみ
	},
] as const;

/** ID で敵を取得 */
export function getEnemyById(id: number): Enemy | undefined {
	return ENEMIES.find((e) => e.id === id);
}

/**
 * 指定曜日に出現可能な敵一覧を取得する。
 * @param dayOfWeek 0=日〜6=土
 */
export function getAvailableEnemies(dayOfWeek: number): Enemy[] {
	return ENEMIES.filter((e) => e.availableDays.length === 0 || e.availableDays.includes(dayOfWeek));
}

/**
 * レアリティに基づく出現確率の重み。
 * common が最も出やすく、boss が最も出にくい。
 */
const RARITY_WEIGHTS: Record<EnemyRarity, number> = {
	common: 50,
	uncommon: 30,
	rare: 15,
	boss: 5,
};

/**
 * 曜日と乱数シードから今日の敵を選出する。
 *
 * @param dayOfWeek 0=日〜6=土
 * @param random 0〜1 の乱数（テスト用に注入可能）
 * @param consecutiveLosses 連敗数（2以上で天井発動 → common 確定）
 */
export function selectDailyEnemy(dayOfWeek: number, random: number, consecutiveLosses = 0): Enemy {
	const available = getAvailableEnemies(dayOfWeek);
	if (available.length === 0) {
		// フォールバック: 全敵から選択（通常到達しない）
		return ENEMIES[0];
	}

	// 天井: 2連敗以上なら common のみ
	const pool = consecutiveLosses >= 2 ? available.filter((e) => e.rarity === 'common') : available;

	// common フィルタ後に空なら available 全体からフォールバック
	const finalPool = pool.length > 0 ? pool : available;

	// 重み付き抽選
	const totalWeight = finalPool.reduce((sum, e) => sum + RARITY_WEIGHTS[e.rarity], 0);
	let threshold = random * totalWeight;

	for (const enemy of finalPool) {
		threshold -= RARITY_WEIGHTS[enemy.rarity];
		if (threshold <= 0) return enemy;
	}

	return finalPool[finalPool.length - 1];
}
