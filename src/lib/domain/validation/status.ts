import { z } from 'zod';

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

/** 年齢別ステータス最大値テーブル */
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

/** 年齢に応じたステータス最大値を取得 */
export function getMaxForAge(age: number): number {
	const entry = AGE_MAX_TABLE.find((e) => e.age === age);
	if (entry) return entry.maxValue;
	if (age < 1) return AGE_MAX_TABLE[0]!.maxValue;
	return AGE_MAX_TABLE[AGE_MAX_TABLE.length - 1]!.maxValue;
}

/** ステータスクエリスキーマ */
export const statusQuerySchema = z.object({
	childId: z.coerce.number().int().positive(),
});
