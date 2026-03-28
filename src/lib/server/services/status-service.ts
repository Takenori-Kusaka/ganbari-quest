// src/lib/server/services/status-service.ts
// ステータス管理サービス層

import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import {
	calcCharacterType,
	calcDeviationScore,
	calcExpToNextLevel,
	calcLevel,
	calcStars,
	calcTrend,
	getMaxForAge,
} from '$lib/domain/validation/status';
import {
	findBenchmark,
	findChildById,
	findRecentStatusHistory,
	findStatuses,
	insertStatusHistory,
	upsertStatus,
} from '$lib/server/db/status-repo';

export interface StatusDetail {
	value: number;
	deviationScore: number;
	stars: number;
	trend: 'up' | 'down' | 'stable';
}

export interface ChildStatus {
	childId: number;
	level: number;
	levelTitle: string;
	expToNextLevel: number;
	maxValue: number;
	statuses: Record<number, StatusDetail>;
	characterType: string;
}

/** 子供のステータスを取得 */
export async function getChildStatus(
	childId: number,
	tenantId: string,
): Promise<ChildStatus | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const maxValue = getMaxForAge(child.age);
	const statusRows = await findStatuses(childId, tenantId);
	const statusMap: Record<number, StatusDetail> = {};

	let totalValue = 0;
	let totalDeviation = 0;
	let categoryCount = 0;

	for (const catDef of CATEGORY_DEFS) {
		const row = statusRows.find((s) => s.categoryId === catDef.id);
		const value = row?.value ?? 0;

		// 市場比較（ベンチマーク）
		const benchmark = await findBenchmark(child.age, catDef.id, tenantId);
		const deviationScore = benchmark
			? calcDeviationScore(value, benchmark.mean, benchmark.stdDev)
			: 50; // ベンチマークがない場合は平均

		const stars = calcStars(value, maxValue);

		// 直近の変動履歴からトレンド判定
		const history = await findRecentStatusHistory(childId, catDef.id, tenantId, 2);
		const recentChange = history.length >= 2 ? (history[0]?.changeAmount ?? 0) : 0;
		const trend = calcTrend(recentChange);

		statusMap[catDef.id] = { value: Math.round(value * 10) / 10, deviationScore, stars, trend };
		totalValue += value;
		totalDeviation += deviationScore;
		categoryCount++;
	}

	const avgStatus = categoryCount > 0 ? totalValue / categoryCount : 0;
	// 年齢別max値で正規化してからレベル判定（LEVEL_TABLEは0-100前提）
	const normalizedAvg = maxValue > 0 ? (avgStatus / maxValue) * 100 : 0;
	const { level, title } = calcLevel(normalizedAvg);
	const expToNextLevel = calcExpToNextLevel(normalizedAvg);

	const avgDeviation = categoryCount > 0 ? totalDeviation / categoryCount : 50;
	const characterType = calcCharacterType(avgDeviation);

	return {
		childId,
		level,
		levelTitle: title,
		expToNextLevel: Math.round(expToNextLevel * 10) / 10,
		maxValue,
		statuses: statusMap,
		characterType,
	};
}

export interface LevelUpInfo {
	oldLevel: number;
	oldTitle: string;
	newLevel: number;
	newTitle: string;
}

/** ステータスを更新する（週次評価から呼ばれる） */
export async function updateStatus(
	childId: number,
	categoryId: number,
	changeAmount: number,
	changeType: string,
	tenantId: string,
): Promise<{ error: 'NOT_FOUND' } | { levelUp: LevelUpInfo | null }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' as const };

	const maxValue = getMaxForAge(child.age);
	const allStatuses = await findStatuses(childId, tenantId);

	// 更新前のレベルを計算
	const beforeValues = CATEGORY_DEFS.map((catDef) => {
		const row = allStatuses.find((s) => s.categoryId === catDef.id);
		return row?.value ?? 0;
	});
	const beforeAvg = beforeValues.reduce((a, b) => a + b, 0) / CATEGORY_DEFS.length;
	const beforeNormalized = maxValue > 0 ? (beforeAvg / maxValue) * 100 : 0;
	const beforeLevel = calcLevel(beforeNormalized);

	// ステータス値を更新
	const currentStatus = allStatuses.find((s) => s.categoryId === categoryId);
	const currentValue = currentStatus?.value ?? 0;
	const newValue = Math.max(0, Math.min(maxValue, currentValue + changeAmount));

	await upsertStatus(childId, categoryId, newValue, tenantId);

	await insertStatusHistory(
		{
			childId,
			categoryId,
			value: newValue,
			changeAmount,
			changeType,
		},
		tenantId,
	);

	// 更新後のレベルを計算
	const afterValues = CATEGORY_DEFS.map((catDef) => {
		if (catDef.id === categoryId) return newValue;
		const row = allStatuses.find((s) => s.categoryId === catDef.id);
		return row?.value ?? 0;
	});
	const afterAvg = afterValues.reduce((a, b) => a + b, 0) / CATEGORY_DEFS.length;
	const afterNormalized = maxValue > 0 ? (afterAvg / maxValue) * 100 : 0;
	const afterLevel = calcLevel(afterNormalized);

	const levelUp =
		afterLevel.level > beforeLevel.level
			? {
					oldLevel: beforeLevel.level,
					oldTitle: beforeLevel.title,
					newLevel: afterLevel.level,
					newTitle: afterLevel.title,
				}
			: null;

	return { levelUp };
}
