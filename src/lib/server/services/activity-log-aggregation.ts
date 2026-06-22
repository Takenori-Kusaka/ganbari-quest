// src/lib/server/services/activity-log-aggregation.ts
// #2097 ADR-0048 week 4 / Fix 2: 循環依存解消のため、「期間内 activity_logs のカテゴリ別集計」を
// 純粋関数として分離。consumer service は本 module を import するが、本 module は
// activity-repo (DB 層) のみに依存し、上位 service には依存しない。
//
// 抽出前の問題 (旧 auto-challenge-service との循環、#2097):
//   両方向の依存があり biome noImportCycles が fail。dynamic import (`await import()`) で
//   回避していたが、ADR-0006 / 静的解析 tier 観点で循環依存自体を解消するのが正道だった。
//
// 抽出後 (#3213 で週次生成は child-challenge-service へ一本化):
//   - activity-log-service → activity-log-aggregation (純粋集計)
//   - child-challenge-service → activity-log-aggregation (週次生成の苦手判定、純粋集計)

import { findActivityLogs } from '$lib/server/db/activity-repo';

export interface ActivityLogEntry {
	id: number;
	activityName: string;
	activityIcon: string;
	categoryId: number;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedAt: string;
}

export interface ActivityLogSummary {
	totalCount: number;
	totalPoints: number;
	byCategory: Record<number, { count: number; points: number }>;
}

/**
 * 子供の期間内 activity_logs を取得し、カテゴリ別集計を行う純粋関数。
 *
 * - 集計のみ。書き込み・通知・外部 API 呼び出し等の副作用は一切持たない。
 * - 上位 service が異なる文脈 (UI 表示 / 弱点カテゴリ分析) で同じ集計を必要とするため
 *   共通化してある。
 */
export async function aggregateActivityLogsByCategory(
	childId: number,
	tenantId: string,
	options: { from?: string; to?: string } = {},
): Promise<{ logs: ActivityLogEntry[]; summary: ActivityLogSummary }> {
	const rows = await findActivityLogs(childId, tenantId, options);

	const byCategory: Record<number, { count: number; points: number }> = {};
	let totalCount = 0;
	let totalPoints = 0;

	for (const row of rows) {
		totalCount++;
		const rowTotal = row.points + row.streakBonus;
		totalPoints += rowTotal;

		if (!byCategory[row.categoryId]) {
			byCategory[row.categoryId] = { count: 0, points: 0 };
		}
		const cat = byCategory[row.categoryId];
		if (cat) {
			cat.count++;
			cat.points += rowTotal;
		}
	}

	return {
		logs: rows,
		summary: { totalCount, totalPoints, byCategory },
	};
}
