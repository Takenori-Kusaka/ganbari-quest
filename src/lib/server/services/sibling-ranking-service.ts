// src/lib/server/services/sibling-ranking-service.ts
// きょうだいランキング — 既存データからリアルタイム算出

import { findActivityLogs } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { getSetting } from '$lib/server/db/settings-repo';

export interface SiblingRanking {
	childId: number;
	childName: string;
	totalCount: number;
	categoryCounts: Record<number, number>;
}

export interface CategoryChampion {
	childId: number;
	childName: string;
	value: number;
}

export interface WeeklyRankingResult {
	mostActive: { childId: number; childName: string; count: number } | null;
	categoryChampions: Record<number, CategoryChampion>;
	rankings: SiblingRanking[];
	encouragement: string;
}

/** 週の開始日（月曜）を取得 */
function getWeekStart(): string {
	const now = new Date();
	const day = now.getDay();
	const diff = day === 0 ? 6 : day - 1; // Monday = 0
	const monday = new Date(now);
	monday.setDate(now.getDate() - diff);
	return monday.toISOString().slice(0, 10);
}

/** 週の終了日（日曜）を取得 */
function getWeekEnd(): string {
	const now = new Date();
	const day = now.getDay();
	const diff = day === 0 ? 0 : 7 - day;
	const sunday = new Date(now);
	sunday.setDate(now.getDate() + diff);
	return sunday.toISOString().slice(0, 10);
}

/** ランキングが有効かチェック（デフォルト: OFF） */
export async function isRankingEnabled(tenantId: string): Promise<boolean> {
	const value = await getSetting('sibling_ranking_enabled', tenantId);
	return value === 'true';
}

/** 今週のきょうだいランキングを算出 */
export async function getWeeklyRanking(tenantId: string): Promise<WeeklyRankingResult> {
	const weekStart = getWeekStart();
	const weekEnd = getWeekEnd();

	const result = await getRankingForPeriod(tenantId, weekStart, weekEnd);

	// 週次 × 複数きょうだいの場合のみ、専用の励ましメッセージ（閾値が月次と異なる）
	if (result.rankings.length > 1) {
		const totalAll = result.rankings.reduce((sum, r) => sum + r.totalCount, 0);
		let encouragement: string;
		if (totalAll === 0) {
			encouragement = 'きょうもがんばろう！';
		} else if (totalAll >= 20) {
			encouragement = 'みんなすごい！かぞくのチカラだね！';
		} else if (totalAll >= 10) {
			encouragement = 'いいかんじ！みんなでがんばってるね！';
		} else {
			encouragement = 'がんばってるね！もっとできるよ！';
		}
		return { ...result, encouragement };
	}

	return result;
}

// ============================================================
// Ranking Trend (#373)
// ============================================================

export interface WeeklyTrendEntry {
	weekLabel: string;
	weekStart: string;
	children: { childId: number; childName: string; count: number }[];
}

export interface RankingTrendResult {
	weeks: WeeklyTrendEntry[];
	children: { childId: number; childName: string }[];
}

/** 過去N週のきょうだい活動数推移を取得 */
export async function getRankingTrend(tenantId: string, numWeeks = 4): Promise<RankingTrendResult> {
	const children = await findAllChildren(tenantId);
	if (children.length === 0) return { weeks: [], children: [] };

	const now = new Date();

	// Build week boundaries first
	interface WeekBoundary {
		weekStart: string;
		weekEnd: string;
		weekLabel: string;
		monday: Date;
	}
	const weekBoundaries: WeekBoundary[] = [];
	for (let w = numWeeks - 1; w >= 0; w--) {
		const refDate = new Date(now);
		refDate.setDate(refDate.getDate() - w * 7);

		const day = refDate.getDay();
		const mondayOffset = day === 0 ? 6 : day - 1;
		const monday = new Date(refDate);
		monday.setDate(refDate.getDate() - mondayOffset);
		const sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);

		weekBoundaries.push({
			weekStart: monday.toISOString().slice(0, 10),
			weekEnd: sunday.toISOString().slice(0, 10),
			weekLabel: `${monday.getMonth() + 1}/${monday.getDate()}〜`,
			monday,
		});
	}

	// Fetch all logs for the entire date range once per child (instead of per week × per child)
	const firstWeek = weekBoundaries[0];
	const lastWeek = weekBoundaries[weekBoundaries.length - 1];
	if (!firstWeek || !lastWeek) return { weeks: [], children: [] };
	const overallFrom = firstWeek.weekStart;
	const overallTo = lastWeek.weekEnd;

	const allChildLogs = await Promise.all(
		children.map(async (child) => {
			const logs = await findActivityLogs(child.id, tenantId, {
				from: overallFrom,
				to: overallTo,
			});
			return { child, logs };
		}),
	);

	// Bucket logs by week in memory
	const weeks: WeeklyTrendEntry[] = weekBoundaries.map((wb) => {
		const childCounts = allChildLogs.map(({ child, logs }) => {
			const count = logs.filter((log) => {
				const d = typeof log.recordedAt === 'string' ? log.recordedAt.slice(0, 10) : '';
				return d >= wb.weekStart && d <= wb.weekEnd;
			}).length;
			return { childId: child.id, childName: child.nickname, count };
		});
		return { weekLabel: wb.weekLabel, weekStart: wb.weekStart, children: childCounts };
	});

	return {
		weeks,
		children: children.map((c) => ({ childId: c.id, childName: c.nickname })),
	};
}

// ============================================================
// Monthly Ranking (#373)
// ============================================================

/** 今月のきょうだいランキングを算出 */
export async function getMonthlyRanking(tenantId: string): Promise<WeeklyRankingResult> {
	const now = new Date();
	const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
	const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

	return getRankingForPeriod(tenantId, monthStart, monthEnd);
}

/** 期間指定のきょうだいランキング（週次・月次共通ロジック） */
async function getRankingForPeriod(
	tenantId: string,
	from: string,
	to: string,
): Promise<WeeklyRankingResult> {
	const children = await findAllChildren(tenantId);

	if (children.length <= 1) {
		const child = children[0];
		if (child) {
			const logs = await findActivityLogs(child.id, tenantId, { from, to });
			const categoryCounts: Record<number, number> = {};
			for (const log of logs) {
				categoryCounts[log.categoryId] = (categoryCounts[log.categoryId] ?? 0) + 1;
			}
			return {
				mostActive:
					logs.length > 0
						? { childId: child.id, childName: child.nickname, count: logs.length }
						: null,
				categoryChampions: {},
				rankings: [
					{ childId: child.id, childName: child.nickname, totalCount: logs.length, categoryCounts },
				],
				encouragement: logs.length > 0 ? 'がんばってるね！' : 'きょうもがんばろう！',
			};
		}
		return {
			mostActive: null,
			categoryChampions: {},
			rankings: [],
			encouragement: 'きょうもがんばろう！',
		};
	}

	const rankings: SiblingRanking[] = await Promise.all(
		children.map(async (child) => {
			const logs = await findActivityLogs(child.id, tenantId, { from, to });
			const categoryCounts: Record<number, number> = {};
			for (const log of logs) {
				categoryCounts[log.categoryId] = (categoryCounts[log.categoryId] ?? 0) + 1;
			}
			return {
				childId: child.id,
				childName: child.nickname,
				totalCount: logs.length,
				categoryCounts,
			};
		}),
	);

	rankings.sort((a, b) => b.totalCount - a.totalCount);

	const mostActive =
		rankings[0] && rankings[0].totalCount > 0
			? {
					childId: rankings[0].childId,
					childName: rankings[0].childName,
					count: rankings[0].totalCount,
				}
			: null;

	const categoryChampions: Record<number, CategoryChampion> = {};
	const allCategories = new Set(rankings.flatMap((r) => Object.keys(r.categoryCounts).map(Number)));
	for (const catId of allCategories) {
		let best: CategoryChampion | null = null;
		for (const r of rankings) {
			const val = r.categoryCounts[catId] ?? 0;
			if (val > 0 && (!best || val > best.value)) {
				best = { childId: r.childId, childName: r.childName, value: val };
			}
		}
		if (best) categoryChampions[catId] = best;
	}

	const totalAll = rankings.reduce((sum, r) => sum + r.totalCount, 0);
	const encouragement =
		totalAll === 0
			? 'きょうもがんばろう！'
			: totalAll < 10
				? 'がんばりはじめたね！'
				: 'がんばってるね！もっとできるよ！';

	return { mostActive, categoryChampions, rankings, encouragement };
}
