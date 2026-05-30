// Demo IActivityRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
//
// #2458-A2 (2026-05-26): 「旧 activities table への write 0 件」3 backend 達成の
// demo backend 側立場の明示化。本 file の全 write method (insertActivity /
// updateActivity / setActivityVisibility / deleteActivity / archiveActivities /
// restoreArchivedActivities / insertActivityLog / insertPointLedger /
// markActivityLogCancelled / deleteDailyMissionsByActivity /
// deleteActivityLogsBeforeDate) は元から no-op stub または synthetic 戻り値
// (id=0) を返すのみで、`DEMO_ACTIVITIES` / `DEMO_MARKETPLACE_ACTIVITIES` /
// `DEMO_ACTIVITY_LOGS` を mutate しない。
//
// 結果: demo Lambda 環境 (`AUTH_MODE=anonymous + DATA_SOURCE=demo`、ADR-0048)
// で「旧 activities table への write」は物理的に発生不可能。read 経路は
// `ALL_DEMO_ACTIVITIES` (hand-curated DEMO_ACTIVITIES + marketplace の merge) を
// primary source として保持し、marketplace integration テスト (#2097 Phase B-7) を
// 退行させない。per-child fixture (`DEMO_CHILD_ACTIVITIES`) は別 file
// (demo/child-activity-repo.ts) で Phase 6 から既に参照されており、必要な per-child
// scope queries は本 file ではなく child-activity-repo 経由で取得される設計。
//
// 関連:
//   - PR #2487 (#2458-A1 sqlite facade rewrite)
//   - ADR-0055 §3.1 per-child primary data model
//   - ADR-0048 demo Lambda stateless 原則
//   - docs/design/data-model-resource-scope.md §4.1

import type { ArchivedReason } from '$lib/domain/archive-types';
import {
	DEMO_ACTIVITIES,
	DEMO_ACTIVITY_LOGS,
	DEMO_CHILDREN,
	DEMO_MARKETPLACE_ACTIVITIES,
} from '$lib/server/demo/demo-data';
import type {
	Activity,
	ActivityFilter,
	ActivityLog,
	ActivityLogSummary,
	Child,
	InsertActivityInput,
	InsertActivityLogInput,
	InsertPointLedgerInput,
	UpdateActivityInput,
} from '../types';

/**
 * #2097 Phase B-7: DEMO_ACTIVITIES (hand-curated baby/baseline) + DEMO_MARKETPLACE_ACTIVITIES
 * (marketplace pack 由来、子供別 902/903/904/906) のマージ済み配列。
 * `name` で dedup し、hand-curated 側を優先する。
 */
const ALL_DEMO_ACTIVITIES: Activity[] = (() => {
	const byName = new Map<string, Activity>();
	for (const a of DEMO_ACTIVITIES) {
		byName.set(a.name, a);
	}
	for (const a of DEMO_MARKETPLACE_ACTIVITIES) {
		if (!byName.has(a.name)) {
			byName.set(a.name, a);
		}
	}
	return Array.from(byName.values());
})();

function filterActivity(a: Activity, filter?: ActivityFilter): boolean {
	if (!filter) return a.isVisible === 1;
	if (filter.includeHidden !== true && a.isVisible !== 1) return false;
	if (typeof filter.categoryId === 'number' && a.categoryId !== filter.categoryId) return false;
	if (typeof filter.childAge === 'number') {
		if (a.ageMin !== null && filter.childAge < a.ageMin) return false;
		if (a.ageMax !== null && filter.childAge > a.ageMax) return false;
	}
	return true;
}

// ---------- Activities ----------

export async function findActivities(
	_tenantId: string,
	filter?: ActivityFilter,
): Promise<Activity[]> {
	return ALL_DEMO_ACTIVITIES.filter((a) => filterActivity(a, filter));
}

export async function findActivityById(
	id: number,
	_tenantId: string,
): Promise<Activity | undefined> {
	return ALL_DEMO_ACTIVITIES.find((a) => a.id === id);
}

export async function insertActivity(
	input: InsertActivityInput,
	_tenantId: string,
): Promise<Activity> {
	// Stub: 入力値で minimal Activity を組み立てて返す
	const now = new Date().toISOString();
	return {
		id: 0,
		name: input.name,
		categoryId: input.categoryId,
		icon: input.icon,
		basePoints: input.basePoints,
		ageMin: input.ageMin,
		ageMax: input.ageMax,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 0,
		source: 'demo',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: null,
		nameKanji: null,
		triggerHint: input.triggerHint ?? null,
		isMainQuest: input.isMainQuest ?? 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: now,
		sourcePresetId: input.sourcePresetId ?? null,
		priority: input.priority ?? 'optional',
	};
}

export async function updateActivity(
	id: number,
	_input: UpdateActivityInput,
	_tenantId: string,
): Promise<Activity | undefined> {
	// Stub: 既存 fixture をそのまま返す (mutation なし)
	return ALL_DEMO_ACTIVITIES.find((a) => a.id === id);
}

export async function setActivityVisibility(
	id: number,
	_visible: boolean,
	_tenantId: string,
): Promise<Activity | undefined> {
	return ALL_DEMO_ACTIVITIES.find((a) => a.id === id);
}

export async function deleteActivity(id: number, _tenantId: string): Promise<Activity | undefined> {
	return ALL_DEMO_ACTIVITIES.find((a) => a.id === id);
}

export async function hasActivityLogs(activityId: number, _tenantId: string): Promise<boolean> {
	return DEMO_ACTIVITY_LOGS.some((l) => l.activityId === activityId);
}

export async function getActivityLogCounts(_tenantId: string): Promise<Record<number, number>> {
	const counts: Record<number, number> = {};
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.cancelled === 1) continue;
		counts[log.activityId] = (counts[log.activityId] ?? 0) + 1;
	}
	return counts;
}

export async function countMainQuestActivities(_tenantId: string): Promise<number> {
	return ALL_DEMO_ACTIVITIES.filter((a) => a.isMainQuest === 1).length;
}

export async function deleteDailyMissionsByActivity(
	_activityId: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

// ---------- Children (convenience lookup) ----------

export async function findChildById(id: number, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

// ---------- Activity Logs ----------

export async function findDailyLog(
	childId: number,
	activityId: number,
	date: string,
	_tenantId: string,
): Promise<ActivityLog | undefined> {
	return DEMO_ACTIVITY_LOGS.find(
		(l) => l.childId === childId && l.activityId === activityId && l.recordedDate === date,
	);
}

export async function findStreakLogs(
	childId: number,
	activityId: number,
	_tenantId: string,
): Promise<{ recordedDate: string }[]> {
	return DEMO_ACTIVITY_LOGS.filter(
		(l) => l.childId === childId && l.activityId === activityId && l.cancelled === 0,
	).map((l) => ({ recordedDate: l.recordedDate }));
}

export async function insertActivityLog(
	input: InsertActivityLogInput,
	_tenantId: string,
): Promise<ActivityLog> {
	// Stub: 入力値で minimal ActivityLog を返す
	return {
		id: 0,
		childId: input.childId,
		activityId: input.activityId,
		points: input.points,
		streakDays: input.streakDays,
		streakBonus: input.streakBonus,
		recordedDate: input.recordedDate,
		recordedAt: input.recordedAt,
		cancelled: 0,
	};
}

export async function findActivityLogById(
	id: number,
	_tenantId: string,
): Promise<ActivityLog | undefined> {
	return DEMO_ACTIVITY_LOGS.find((l) => l.id === id);
}

export async function markActivityLogCancelled(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function findActivityLogs(
	childId: number,
	_tenantId: string,
	options?: { from?: string; to?: string },
): Promise<ActivityLogSummary[]> {
	return DEMO_ACTIVITY_LOGS.filter((l) => {
		if (l.childId !== childId) return false;
		if (l.cancelled === 1) return false;
		if (options?.from && l.recordedDate < options.from) return false;
		if (options?.to && l.recordedDate > options.to) return false;
		return true;
	}).map((l) => {
		const activity = ALL_DEMO_ACTIVITIES.find((a) => a.id === l.activityId);
		return {
			id: l.id,
			activityName: activity?.name ?? 'unknown',
			activityIcon: activity?.icon ?? '',
			categoryId: activity?.categoryId ?? 0,
			points: l.points,
			streakDays: l.streakDays,
			streakBonus: l.streakBonus,
			recordedAt: l.recordedAt,
		};
	});
}

export async function countTodayActiveRecords(
	childId: number,
	activityId: number,
	date: string,
	_tenantId: string,
): Promise<number> {
	return DEMO_ACTIVITY_LOGS.filter(
		(l) =>
			l.childId === childId &&
			l.activityId === activityId &&
			l.recordedDate === date &&
			l.cancelled === 0,
	).length;
}

export async function getTodayActivityCountsByChild(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<{ activityId: number; count: number }[]> {
	const counts = new Map<number, number>();
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId !== childId || log.recordedDate !== date || log.cancelled !== 0) continue;
		counts.set(log.activityId, (counts.get(log.activityId) ?? 0) + 1);
	}
	return Array.from(counts.entries()).map(([activityId, count]) => ({ activityId, count }));
}

export async function findTodayRecordedActivityIds(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<number[]> {
	const ids = new Set<number>();
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId === childId && log.recordedDate === today && log.cancelled === 0) {
			ids.add(log.activityId);
		}
	}
	return Array.from(ids);
}

// ---------- Aggregation queries ----------

export async function findDistinctRecordedDates(
	childId: number,
	_tenantId: string,
): Promise<{ recordedDate: string }[]> {
	const dates = new Set<string>();
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId === childId && log.cancelled === 0) dates.add(log.recordedDate);
	}
	return Array.from(dates).map((d) => ({ recordedDate: d }));
}

export async function countActiveActivityLogs(childId: number, _tenantId: string): Promise<number> {
	return DEMO_ACTIVITY_LOGS.filter((l) => l.childId === childId && l.cancelled === 0).length;
}

export async function getCategoryCountsByDate(
	childId: number,
	_tenantId: string,
): Promise<{ recordedDate: string; categoryCount: number }[]> {
	const byDate = new Map<string, Set<number>>();
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId !== childId || log.cancelled !== 0) continue;
		const activity = ALL_DEMO_ACTIVITIES.find((a) => a.id === log.activityId);
		if (!activity) continue;
		if (!byDate.has(log.recordedDate)) byDate.set(log.recordedDate, new Set());
		byDate.get(log.recordedDate)?.add(activity.categoryId);
	}
	return Array.from(byDate.entries()).map(([recordedDate, set]) => ({
		recordedDate,
		categoryCount: set.size,
	}));
}

export async function countDistinctCategories(childId: number, _tenantId: string): Promise<number> {
	const categories = new Set<number>();
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId !== childId || log.cancelled !== 0) continue;
		const activity = ALL_DEMO_ACTIVITIES.find((a) => a.id === log.activityId);
		if (activity) categories.add(activity.categoryId);
	}
	return categories.size;
}

export async function findTodayLogsWithCategory(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<{ activityId: number; categoryId: number }[]> {
	return DEMO_ACTIVITY_LOGS.filter(
		(l) => l.childId === childId && l.recordedDate === date && l.cancelled === 0,
	)
		.map((l) => {
			const activity = ALL_DEMO_ACTIVITIES.find((a) => a.id === l.activityId);
			return activity ? { activityId: l.activityId, categoryId: activity.categoryId } : null;
		})
		.filter((x): x is { activityId: number; categoryId: number } => x !== null);
}

export async function getComboPointsGranted(
	_childId: number,
	_descriptionPrefix: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function countActiveActivityLogsByCategory(
	childId: number,
	categoryId: number,
	_tenantId: string,
): Promise<number> {
	let count = 0;
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId !== childId || log.cancelled !== 0) continue;
		const activity = ALL_DEMO_ACTIVITIES.find((a) => a.id === log.activityId);
		if (activity?.categoryId === categoryId) count++;
	}
	return count;
}

export async function countPointLedgerEntriesByType(
	_childId: number,
	_type: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function countPointLedgerEntriesByTypeAndDate(
	_childId: number,
	_type: string,
	_date: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}

// ---------- Must activities (#1755) ----------

export async function findMustActivitiesWithToday(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<{
	logged: number;
	total: number;
	activities: Array<{ id: number; name: string; icon: string; loggedToday: number }>;
}> {
	const mustActivities = ALL_DEMO_ACTIVITIES.filter(
		(a) => a.priority === 'must' && a.isVisible === 1,
	);
	const todayRecorded = new Set(
		DEMO_ACTIVITY_LOGS.filter(
			(l) => l.childId === childId && l.recordedDate === today && l.cancelled === 0,
		).map((l) => l.activityId),
	);
	const activities = mustActivities.map((a) => ({
		id: a.id,
		name: a.name,
		icon: a.icon,
		loggedToday: todayRecorded.has(a.id) ? 1 : 0,
	}));
	const logged = activities.filter((a) => a.loggedToday === 1).length;
	return { logged, total: mustActivities.length, activities };
}

// ---------- Archive / Restore ----------
// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。

export async function archiveActivities(
	_ids: number[],
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function restoreArchivedActivities(
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

// ---------- Point Ledger ----------

export async function insertPointLedger(
	_input: InsertPointLedgerInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

// ---------- Retention cleanup ----------

export async function deleteActivityLogsBeforeDate(
	_childId: number,
	_cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}
