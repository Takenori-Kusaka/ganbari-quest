import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/sibling-ranking-service.ts
// きょうだいランキング — 既存データからリアルタイム算出

import {
	addDaysJST,
	jstDateOfIso,
	monthEndJST,
	monthStartJST,
	weekEndJST,
	weekStartJST,
} from '$lib/domain/date-utils';
// #4685 (ADR-0011): 年齢帯ごとの機能可否は age-tier.ts の 1 箇所で判定する
import { hasAgeTierCapability, normalizeUiMode } from '$lib/domain/validation/age-tier';
import { findActivityLogs } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { getSetting } from '$lib/server/db/settings-repo';

/**
 * #4685: ランキング (競争) の集計対象。準備モード (baby) の子は除外する。
 * 兄の画面に「はなこちゃん (1 歳) 0かい」が並ぶのは ADR-0011 (baby はゲーミフィケーション
 * 非適用) に反し、親から見ても意味のない比較になる。
 *
 * uiMode は `normalizeUiMode` を通す (旧コード / 未設定は既定モード扱い)。ここで「不明なら除外」に
 * 倒すと**実在する子がランキングから消える**ため、除外は baby と確定したときだけ行う。
 */
function rankingTargets<T extends { uiMode?: string | null }>(children: T[]): T[] {
	return children.filter((c) =>
		hasAgeTierCapability(normalizeUiMode(c.uiMode ?? ''), 'siblingRanking'),
	);
}

export interface SiblingRanking {
	childId: ChildId;
	childName: string;
	totalCount: number;
	categoryCounts: Record<string, number>;
}

export interface CategoryChampion {
	childId: ChildId;
	childName: string;
	value: number;
}

export interface WeeklyRankingResult {
	mostActive: { childId: ChildId; childName: string; count: number } | null;
	categoryChampions: Record<string, CategoryChampion>;
	rankings: SiblingRanking[];
	encouragement: string;
}

// 週 / 月の境界は JST SSOT (date-utils) 経由で決める (#4015)。
// 旧実装は `new Date().getDay()` / `setDate(now.getDate() - diff)` のローカル TZ 算術に
// `toISOString()` の UTC 日付化を重ねており、Lambda (UTC) では JST 月曜 00:00〜09:00 に
// 前週の範囲を、NUC (JST) では朝 09:00 前に前日側の範囲を返していた。

/** ランキングが有効かチェック（デフォルト: OFF） */
export async function isRankingEnabled(tenantId: string): Promise<boolean> {
	const value = await getSetting('sibling_ranking_enabled', tenantId);
	return value === 'true';
}

/** 今週のきょうだいランキングを算出 */
export async function getWeeklyRanking(tenantId: string): Promise<WeeklyRankingResult> {
	const weekStart = weekStartJST();
	const weekEnd = weekEndJST();

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
	children: { childId: ChildId; childName: string; count: number }[];
}

export interface RankingTrendResult {
	weeks: WeeklyTrendEntry[];
	children: { childId: ChildId; childName: string }[];
}

/** 過去N週のきょうだい活動数推移を取得 */
export async function getRankingTrend(tenantId: string, numWeeks = 4): Promise<RankingTrendResult> {
	// #4685: 準備モード (baby) は競争の集計対象外
	const children = rankingTargets(await findAllChildren(tenantId));
	if (children.length === 0) return { weeks: [], children: [] };

	const now = new Date();

	// Build week boundaries first
	interface WeekBoundary {
		weekStart: string;
		weekEnd: string;
		weekLabel: string;
	}
	const weekBoundaries: WeekBoundary[] = [];
	// 今週の月曜 (JST) を起点に 7 日ずつ遡る。暦日文字列上の加算なので TZ 非依存 (#4015)。
	const currentMonday = weekStartJST(now);
	for (let w = numWeeks - 1; w >= 0; w--) {
		const monday = addDaysJST(currentMonday, -w * 7);
		const sunday = addDaysJST(monday, 6);
		const [, mm, dd] = monday.split('-');
		weekBoundaries.push({
			weekStart: monday,
			weekEnd: sunday,
			weekLabel: `${Number(mm)}/${Number(dd)}〜`,
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
				const d = typeof log.recordedAt === 'string' ? jstDateOfIso(log.recordedAt) : '';
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
	return getRankingForPeriod(tenantId, monthStartJST(), monthEndJST());
}

/** 期間指定のきょうだいランキング（週次・月次共通ロジック） */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
async function getRankingForPeriod(
	tenantId: string,
	from: string,
	to: string,
): Promise<WeeklyRankingResult> {
	// #4685: 準備モード (baby) は競争の集計対象外 (兄弟が baby だけなら「1 人」として扱う)
	const children = rankingTargets(await findAllChildren(tenantId));

	if (children.length <= 1) {
		const child = children[0];
		if (child) {
			const logs = await findActivityLogs(child.id, tenantId, { from, to });
			const categoryCounts: Record<string, number> = {};
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
			const categoryCounts: Record<string, number> = {};
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

	const categoryChampions: Record<string, CategoryChampion> = {};
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
