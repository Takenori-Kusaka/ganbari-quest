// src/lib/domain/validation/login-bonus.ts
// ログインボーナスのドメインロジック

/** おみくじランク定義 */
export const OMIKUJI_RANKS = [
	{ rank: '大大吉', weight: 1, basePoints: 30 },
	{ rank: '大吉', weight: 5, basePoints: 15 },
	{ rank: '中吉', weight: 15, basePoints: 7 },
	{ rank: '小吉', weight: 25, basePoints: 5 },
	{ rank: '吉', weight: 34, basePoints: 3 },
	{ rank: '末吉', weight: 20, basePoints: 2 },
] as const;

export type OmikujiRank = (typeof OMIKUJI_RANKS)[number]['rank'];

/** 連続ログイン倍率テーブル */
export const LOGIN_MULTIPLIERS: { days: number; multiplier: number }[] = [
	{ days: 30, multiplier: 3.0 },
	{ days: 14, multiplier: 2.5 },
	{ days: 7, multiplier: 2.0 },
	{ days: 3, multiplier: 1.5 },
];

/** 重み付きランダムでおみくじランクを抽選 */
export function drawOmikuji(): (typeof OMIKUJI_RANKS)[number] {
	const totalWeight = OMIKUJI_RANKS.reduce((sum, r) => sum + r.weight, 0);
	let random = Math.random() * totalWeight;

	for (const rank of OMIKUJI_RANKS) {
		random -= rank.weight;
		if (random <= 0) return rank;
	}

	// フォールバック（到達しないはず）
	return OMIKUJI_RANKS[OMIKUJI_RANKS.length - 1]!;
}

/** 連続ログイン日数から倍率を算出 */
export function getLoginMultiplier(consecutiveDays: number): number {
	for (const entry of LOGIN_MULTIPLIERS) {
		if (consecutiveDays >= entry.days) return entry.multiplier;
	}
	return 1.0;
}

/** 最終ポイントを計算（base × multiplier, 切り捨て） */
export function calcLoginBonusPoints(
	basePoints: number,
	multiplier: number,
): number {
	return Math.floor(basePoints * multiplier);
}
