import { z } from 'zod';
import { CATEGORIES } from './activity';
import type { Category } from './activity';

/** レベルテーブル */
export const LEVEL_TABLE: {
	level: number;
	minAvg: number;
	maxAvg: number;
	title: string;
}[] = [
	{ level: 1, minAvg: 0, maxAvg: 9, title: 'はじめのぼうけんしゃ' },
	{ level: 2, minAvg: 10, maxAvg: 19, title: 'がんばりルーキー' },
	{ level: 3, minAvg: 20, maxAvg: 29, title: 'わくわくファイター' },
	{ level: 4, minAvg: 30, maxAvg: 39, title: 'つよつよチャレンジャー' },
	{ level: 5, minAvg: 40, maxAvg: 49, title: 'きらきらヒーロー' },
	{ level: 6, minAvg: 50, maxAvg: 59, title: 'すごうでアドベンチャー' },
	{ level: 7, minAvg: 60, maxAvg: 69, title: 'そらとぶチャンピオン' },
	{ level: 8, minAvg: 70, maxAvg: 79, title: 'きせきのマスター' },
	{ level: 9, minAvg: 80, maxAvg: 89, title: 'せかいいちのつわもの' },
	{ level: 10, minAvg: 90, maxAvg: 100, title: 'かみさまレベル' },
];

/** 平均ステータスからレベルを算出 */
export function calcLevel(avgStatus: number): { level: number; title: string } {
	const clamped = Math.max(0, Math.min(100, avgStatus));
	const entry = LEVEL_TABLE.find(
		(e) => clamped >= e.minAvg && clamped <= e.maxAvg,
	);
	return entry
		? { level: entry.level, title: entry.title }
		: { level: 1, title: LEVEL_TABLE[0]!.title };
}

/** 次のレベルまでに必要なステータスポイント */
export function calcExpToNextLevel(avgStatus: number): number {
	const { level } = calcLevel(avgStatus);
	if (level >= 10) return 0;
	const nextEntry = LEVEL_TABLE.find((e) => e.level === level + 1);
	if (!nextEntry) return 0;
	return Math.max(0, nextEntry.minAvg - avgStatus);
}

/** 偏差値計算: (個人値 - 平均) / 標準偏差 × 10 + 50 */
export function calcDeviationScore(
	value: number,
	mean: number,
	stdDev: number,
): number {
	if (stdDev === 0) return 50;
	return Math.round(((value - mean) / stdDev) * 10 + 50);
}

/** 偏差値から星評価（5段階） */
export function calcStars(deviationScore: number): number {
	if (deviationScore >= 65) return 5;
	if (deviationScore >= 58) return 4;
	if (deviationScore >= 50) return 3;
	if (deviationScore >= 42) return 2;
	return 1;
}

/** キャラクター判定 */
export function calcCharacterType(avgDeviationScore: number): string {
	if (avgDeviationScore >= 55) return 'hero';
	if (avgDeviationScore >= 45) return 'normal';
	return 'ganbari';
}

/** 年齢係数（ステータス減少用） */
export function getAgeCoefficient(age: number): number {
	if (age <= 6) return 0.3;
	if (age <= 12) return 0.5;
	if (age <= 18) return 0.7;
	return 0.9;
}

/** ステータス減少計算 */
export function calcDecay(
	daysSinceActivity: number,
	age: number,
): number {
	if (daysSinceActivity <= 0) return 0;
	const coeff = getAgeCoefficient(age);
	const baseDecay = coeff * 0.1;
	const acceleration = 0.05 * Math.max(0, daysSinceActivity - 1);
	return baseDecay + acceleration;
}

/** トレンド判定 */
export function calcTrend(
	recentChange: number,
): 'up' | 'down' | 'stable' {
	if (recentChange > 0.5) return 'up';
	if (recentChange < -0.5) return 'down';
	return 'stable';
}

/** ステータスクエリスキーマ */
export const statusQuerySchema = z.object({
	childId: z.coerce.number().int().positive(),
});
