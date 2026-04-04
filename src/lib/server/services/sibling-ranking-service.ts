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
	const children = await findAllChildren(tenantId);

	if (children.length <= 1) {
		// 1人家庭の場合: gracefulに自分がチャンピオン
		const child = children[0];
		if (child) {
			const logs = await findActivityLogs(child.id, tenantId, {
				from: getWeekStart(),
				to: getWeekEnd(),
			});
			const categoryCounts: Record<number, number> = {};
			for (const log of logs) {
				categoryCounts[log.categoryId] = (categoryCounts[log.categoryId] ?? 0) + 1;
			}
			const ranking: SiblingRanking = {
				childId: child.id,
				childName: child.nickname,
				totalCount: logs.length,
				categoryCounts,
			};
			return {
				mostActive:
					logs.length > 0
						? { childId: child.id, childName: child.nickname, count: logs.length }
						: null,
				categoryChampions: {},
				rankings: [ranking],
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

	const weekStart = getWeekStart();
	const weekEnd = getWeekEnd();

	// 全きょうだいの今週の活動ログを取得
	const rankings: SiblingRanking[] = await Promise.all(
		children.map(async (child) => {
			const logs = await findActivityLogs(child.id, tenantId, {
				from: weekStart,
				to: weekEnd,
			});
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

	// 総活動数ランキング（降順）
	rankings.sort((a, b) => b.totalCount - a.totalCount);

	// 最もアクティブな子供
	const mostActive =
		rankings[0] && rankings[0].totalCount > 0
			? {
					childId: rankings[0].childId,
					childName: rankings[0].childName,
					count: rankings[0].totalCount,
				}
			: null;

	// カテゴリ別チャンピオン
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
		if (best) {
			categoryChampions[catId] = best;
		}
	}

	// 励ましメッセージ
	const totalAll = rankings.reduce((sum, r) => sum + r.totalCount, 0);
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

	return { mostActive, categoryChampions, rankings, encouragement };
}
