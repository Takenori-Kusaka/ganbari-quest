// src/lib/domain/validation/login-bonus.ts
// ログインボーナスのドメインロジック

import { prevDateJST } from '$lib/domain/date-utils';

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
	return OMIKUJI_RANKS[OMIKUJI_RANKS.length - 1] as (typeof OMIKUJI_RANKS)[number];
}

/** 連続ログイン日数から倍率を算出 */
export function getLoginMultiplier(consecutiveDays: number): number {
	for (const entry of LOGIN_MULTIPLIERS) {
		if (consecutiveDays >= entry.days) return entry.multiplier;
	}
	return 1.0;
}

/** 最終ポイントを計算（base × multiplier, 切り捨て） */
export function calcLoginBonusPoints(basePoints: number, multiplier: number): number {
	return Math.floor(basePoints * multiplier);
}

/** counter 縮約 (#3330 案 B) の導出結果。 */
export interface StreakCounter {
	lastLoginDate: string;
	currentStreak: number;
}

/**
 * per-date ログイン日集合から counter (lastLoginDate + currentStreak) を導出する (#3330 案 B)。
 *
 * 旧 `calculateConsecutiveDays` (findRecentBonuses(60) 遡り) と同じ論理:
 * 最新ログイン日を終端とし、前日が集合に存在する限り遡って連続日数を数える。
 * 旧 backup (`loginBonuses[]`) の後方互換 import fold と sqlite lazy migration の JS 側検証で共有する。
 */
export function deriveStreakCounter(loginDates: readonly string[]): StreakCounter | null {
	if (loginDates.length === 0) return null;
	const set = new Set(loginDates);
	let last = '';
	for (const d of set) {
		if (d > last) last = d;
	}
	let streak = 1;
	let check = prevDateJST(last);
	while (set.has(check)) {
		streak++;
		check = prevDateJST(check);
	}
	return { lastLoginDate: last, currentStreak: streak };
}

/**
 * counter 状態から「今日 claim した場合の連続日数」を導出する (#3330 案 B)。
 * - counter 無し (初回) → 1
 * - 当日 claim 済 → currentStreak (据置)
 * - 昨日まで連続 → currentStreak + 1
 * - 途切れ → 1
 */
export function deriveConsecutiveDays(
	counter: StreakCounter | null | undefined,
	today: string,
): number {
	if (!counter) return 1;
	if (counter.lastLoginDate === today) return counter.currentStreak;
	if (counter.lastLoginDate === prevDateJST(today)) return counter.currentStreak + 1;
	return 1;
}
