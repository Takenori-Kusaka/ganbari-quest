// src/lib/server/services/status-service.ts
// ステータス管理サービス層

import { CATEGORIES } from '$lib/domain/validation/activity';
import type { Category } from '$lib/domain/validation/activity';
import {
	calcLevel,
	calcExpToNextLevel,
	calcDeviationScore,
	calcStars,
	calcCharacterType,
	calcTrend,
} from '$lib/domain/validation/status';
import {
	findStatuses,
	findBenchmark,
	findChildById,
	findRecentStatusHistory,
	upsertStatus,
	insertStatusHistory,
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
	statuses: Record<string, StatusDetail>;
	characterType: string;
}

/** 子供のステータスを取得 */
export function getChildStatus(
	childId: number,
): ChildStatus | { error: 'NOT_FOUND' } {
	const child = findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const statusRows = findStatuses(childId);
	const statusMap: Record<string, StatusDetail> = {};

	let totalValue = 0;
	let totalDeviation = 0;
	let categoryCount = 0;

	for (const cat of CATEGORIES) {
		const row = statusRows.find((s) => s.category === cat);
		const value = row?.value ?? 0;

		// 市場比較（ベンチマーク）
		const benchmark = findBenchmark(child.age, cat);
		const deviationScore = benchmark
			? calcDeviationScore(value, benchmark.mean, benchmark.stdDev)
			: 50; // ベンチマークがない場合は平均

		const stars = calcStars(deviationScore);

		// 直近の変動履歴からトレンド判定
		const history = findRecentStatusHistory(childId, cat, 2);
		const recentChange =
			history.length >= 2
				? history[0]!.changeAmount
				: 0;
		const trend = calcTrend(recentChange);

		statusMap[cat] = { value: Math.round(value * 10) / 10, deviationScore, stars, trend };
		totalValue += value;
		totalDeviation += deviationScore;
		categoryCount++;
	}

	const avgStatus = categoryCount > 0 ? totalValue / categoryCount : 0;
	const { level, title } = calcLevel(avgStatus);
	const expToNextLevel = calcExpToNextLevel(avgStatus);

	const avgDeviation = categoryCount > 0 ? totalDeviation / categoryCount : 50;
	const characterType = calcCharacterType(avgDeviation);

	return {
		childId,
		level,
		levelTitle: title,
		expToNextLevel: Math.round(expToNextLevel * 10) / 10,
		statuses: statusMap,
		characterType,
	};
}

/** ステータスを更新する（週次評価から呼ばれる） */
export function updateStatus(
	childId: number,
	category: string,
	changeAmount: number,
	changeType: string,
) {
	const child = findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' as const };

	const currentStatus = findStatuses(childId).find(
		(s) => s.category === category,
	);
	const currentValue = currentStatus?.value ?? 0;
	const newValue = Math.max(0, Math.min(100, currentValue + changeAmount));

	const updated = upsertStatus(childId, category, newValue);

	insertStatusHistory({
		childId,
		category,
		value: newValue,
		changeAmount,
		changeType,
	});

	return updated;
}
