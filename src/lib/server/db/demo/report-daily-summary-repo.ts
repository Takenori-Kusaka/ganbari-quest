import { asChildId, type ChildId } from '$lib/domain/ids';
// Demo IReportDailySummaryRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
//
// #4712: read は fixture の活動ログ (DEMO_ACTIVITY_LOGS) から日次集計を組み立てる。
// 旧実装は常に `[]` を返しており、デモの月次レポート / ダッシュボードが全員
// 「活動 0 回・活動日数 0・実績 0」に見えていた (fixture には直近 0〜10 日の
// 活動ログがあるのに「使われていない家族」に見える = デモの価値訴求が成立しない)。
// write は従来どおり no-op (fixture immutability、ADR-0048)。

import {
	DEMO_ACTIVITIES,
	DEMO_ACTIVITY_LOGS,
	DEMO_POINT_BALANCES,
	DEMO_STATUSES,
} from '../../demo/demo-data';
import type { InsertReportDailySummaryInput, ReportDailySummary } from '../types';

/** activityId → categoryId (fixture の活動マスタから解決。未知は 0 = 未分類)。 */
function categoryIdOf(activityId: string): number {
	const activity = DEMO_ACTIVITIES.find((a) => String(a.id) === String(activityId));
	return activity ? Number(activity.categoryId) : 0;
}

/** 子供の現在レベル (fixture の status 最大値。デモ他画面と同じ数字を使う)。 */
function levelOf(childId: ChildId): number {
	const levels = DEMO_STATUSES.filter((st) => st.childId === childId).map((st) => st.level);
	return levels.length > 0 ? Math.max(...levels) : 1;
}

/** 子供の累計ポイント (fixture の残高。デモ他画面と同じ数字を使う)。 */
function balanceOf(childId: ChildId): number {
	return DEMO_POINT_BALANCES[String(childId)] ?? 0;
}

/**
 * fixture の活動ログを (childId, date) で畳み、`ReportDailySummary` 相当を組み立てる。
 * cancelled 済ログは除外する (実 repo の集計と同じ扱い)。
 */
function buildSummaries(filter: {
	childId?: ChildId;
	tenantId: string;
	startDate: string;
	endDate: string;
}): ReportDailySummary[] {
	const byKey = new Map<string, ReportDailySummary>();

	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.cancelled) continue;
		if (filter.childId !== undefined && log.childId !== filter.childId) continue;
		if (log.recordedDate < filter.startDate || log.recordedDate > filter.endDate) continue;

		const key = `${log.childId}:${log.recordedDate}`;
		const existing = byKey.get(key);
		const categoryId = String(categoryIdOf(String(log.activityId)));
		if (existing) {
			const breakdown = JSON.parse(existing.categoryBreakdown) as Record<string, number>;
			breakdown[categoryId] = (breakdown[categoryId] ?? 0) + 1;
			byKey.set(key, {
				...existing,
				activityCount: existing.activityCount + 1,
				streakDays: Math.max(existing.streakDays, log.streakDays ?? 0),
				categoryBreakdown: JSON.stringify(breakdown),
			});
			continue;
		}

		byKey.set(key, {
			id: key,
			tenantId: filter.tenantId,
			childId: asChildId(log.childId),
			date: log.recordedDate,
			activityCount: 1,
			categoryBreakdown: JSON.stringify({ [categoryId]: 1 }),
			// fixture にチェックリスト日次実績が無いため空 (実 repo と同じ JSON 形状を返す)
			checklistCompletion: '{}',
			// #4712: 日次スナップショットの「レベル / 累計ポイント」は、デモ他画面 (ダッシュボード /
			// ステータス) と同じ fixture 値を使う。ログから再計算すると同じデモ内で数字が食い違い、
			// 月次レポートだけ「レベル 1・17pt」のような別人の数字になる。
			level: levelOf(log.childId),
			totalPoints: balanceOf(log.childId),
			streakDays: log.streakDays ?? 0,
			// 実績システムは #322 で廃止済。0 固定 (嘘の数字を出さない)
			newAchievements: 0,
			createdAt: log.recordedAt,
		});
	}

	return [...byKey.values()].sort((a, b) =>
		a.date === b.date
			? String(a.childId).localeCompare(String(b.childId))
			: a.date < b.date
				? -1
				: 1,
	);
}

export async function findByChildAndDateRange(
	childId: ChildId,
	startDate: string,
	endDate: string,
	tenantId: string,
): Promise<ReportDailySummary[]> {
	return buildSummaries({ childId, startDate, endDate, tenantId });
}

export async function findByTenantAndDateRange(
	tenantId: string,
	startDate: string,
	endDate: string,
): Promise<ReportDailySummary[]> {
	return buildSummaries({ startDate, endDate, tenantId });
}

export async function upsert(_input: InsertReportDailySummaryInput): Promise<void> {
	// Stub: no-op (fixture immutability)
}

export async function deleteOlderThan(_tenantId: string, _cutoffDate: string): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
