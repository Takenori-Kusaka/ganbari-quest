// src/lib/server/db/sqlite/activity-repo.ts
// 活動関連のリポジトリ層（DBアクセス）
//
// #2458-A1 (2026-05-26): facade rewrite — 旧 `activities` table への write を完全停止し、
// 全 method を `child_activities` 経由に rewrite。これにより #2458-C (旧 table physical drop)
// が安全に実行可能になる。signature は不変 (caller 修正 0)。
//
// 設計:
//   - read 系 (findActivities / findActivityById / findMustActivitiesWithToday /
//     findTodayLogsWithCategory / findActivityLogs / countMainQuestActivities) は既に
//     `child_activities` 経由 (PR-3 で部分移行済)。本 PR で残る aggregate (findActivities /
//     countMainQuestActivities) を child loop aggregate に統一。
//   - write 系 (insertActivity / updateActivity / setActivityVisibility / deleteActivity /
//     archiveActivities / restoreArchivedActivities) は tenant 全 child を loop して
//     activity_id → childId を逆引きしてから child_activities を操作。
//     insertActivity は新規 instance のため、tenant の最初の child に bind する暫定動作
//     (activity-service.ts の createActivity と同パターン)。
//
// 関連:
//   - PR #2455 (PR-3 facade transparent migration、findActivityById 等 4 method)
//   - ADR-0055 §3.1 per-child primary data model
//   - docs/design/data-model-resource-scope.md §4.1

import {
	and,
	count,
	countDistinct,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	or,
	sql,
} from 'drizzle-orm';
import { db } from '../client';
import { activityLogs, childActivities, children, dailyMissions, pointLedger } from '../schema';
import type { Activity, ActivityFilter, InsertActivityInput, UpdateActivityInput } from '../types';

// ============================================================
// Internal helpers — ChildActivity → Activity shape adapter
// ============================================================
//
// 既存 caller の `Activity[]` 型シグネチャを破壊しないため、`ChildActivity` 行を
// `Activity` shape に変換する。差分 field (ageMin / ageMax / gradeLevel / subcategory /
// description) は null で埋める。callsite で参照されている場合は null fallback で動作。

function _toActivityShape(c: {
	id: number;
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	isVisible: number;
	dailyLimit: number | null;
	sortOrder: number;
	source: string;
	nameKana: string | null;
	nameKanji: string | null;
	triggerHint: string | null;
	isMainQuest: number;
	isArchived: number;
	archivedReason: string | null;
	createdAt: string;
	sourcePresetId?: string | null;
	priority: 'must' | 'optional';
}): Activity {
	return {
		id: c.id,
		name: c.name,
		categoryId: c.categoryId,
		icon: c.icon,
		basePoints: c.basePoints,
		ageMin: null, // ChildActivity は per-child instance のため age filter なし (ADR-0055)
		ageMax: null,
		isVisible: c.isVisible,
		dailyLimit: c.dailyLimit,
		sortOrder: c.sortOrder,
		source: c.source,
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: c.nameKana,
		nameKanji: c.nameKanji,
		triggerHint: c.triggerHint,
		isMainQuest: c.isMainQuest,
		isArchived: c.isArchived,
		archivedReason: c.archivedReason,
		createdAt: c.createdAt,
		sourcePresetId: c.sourcePresetId ?? null,
		priority: c.priority,
	};
}

/**
 * activity_id から childId を逆引きする (tenant 内)。
 * write 系 method (updateActivity / setActivityVisibility / deleteActivity) で必要。
 * 見つからなければ undefined。
 */
async function _resolveChildIdForActivity(
	id: number,
	_tenantId: string,
): Promise<number | undefined> {
	const row = await db
		.select({ childId: childActivities.childId })
		.from(childActivities)
		.where(eq(childActivities.id, id))
		.get();
	return row?.childId;
}

/**
 * tenant 内全 child を取得 (insertActivity の fallback bind 用)。
 */
async function _findFirstChild(_tenantId: string): Promise<{ id: number } | undefined> {
	return db.select({ id: children.id }).from(children).orderBy(children.id).get();
}

// ============================================================
// Activities (CRUD — child_activities 経由)
// ============================================================

export async function findActivities(
	_tenantId: string,
	filter?: ActivityFilter,
): Promise<Activity[]> {
	const conditions = [];

	// #783: archive されたリソースをデフォルトで除外（NULL互換: #962）
	conditions.push(or(eq(childActivities.isArchived, 0), isNull(childActivities.isArchived)));

	if (filter?.categoryId) {
		conditions.push(eq(childActivities.categoryId, filter.categoryId));
	}

	if (!filter?.includeHidden) {
		conditions.push(eq(childActivities.isVisible, 1));
	}

	// NOTE: ChildActivity は per-child instance のため ageMin/ageMax 列なし。
	// filter.childAge は (ADR-0055 §3.1) instance 化時点で適齢のため filter 適用しない。

	let query = db.select().from(childActivities).$dynamic();
	if (conditions.length > 0) {
		query = query.where(and(...conditions));
	}
	const rows = await query.orderBy(childActivities.sortOrder).all();
	return rows.map(_toActivityShape);
}

export async function findActivityById(id: number, _tenantId: string) {
	// #2362 PR-3 Phase 7b-2c: child_activities から取得 (PR-3 で移行済)。
	const row = await db.select().from(childActivities).where(eq(childActivities.id, id)).get();
	return row ? _toActivityShape(row) : undefined;
}

export async function insertActivity(
	input: InsertActivityInput,
	tenantId: string,
): Promise<Activity> {
	// #2458-A1: family master insert を廃止し、tenant の最初の child に bind する。
	// signature `(input, tenantId)` を維持しつつ child binding を内部で解決。
	// activity-service.ts の createActivity と同パターン。
	const firstChild = await _findFirstChild(tenantId);
	if (!firstChild) {
		throw new Error('insertActivity: tenant に child が存在しないため作成不可');
	}
	const row = db
		.insert(childActivities)
		.values({
			childId: firstChild.id,
			name: input.name,
			categoryId: input.categoryId,
			icon: input.icon,
			basePoints: input.basePoints,
			triggerHint: input.triggerHint ?? null,
			isMainQuest: input.isMainQuest ?? 0,
			sourcePresetId: input.sourcePresetId ?? null,
			priority: input.priority ?? 'optional',
		})
		.returning()
		.get();
	if (!row) {
		throw new Error('insertActivity: insert returned no row');
	}
	return _toActivityShape(row);
}

export async function updateActivity(
	id: number,
	input: UpdateActivityInput,
	tenantId: string,
): Promise<Activity | undefined> {
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	// ChildActivity に存在しない field (ageMin / ageMax) は drop
	const updateData: Record<string, unknown> = {};
	if (input.name !== undefined) updateData.name = input.name;
	if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;
	if (input.icon !== undefined) updateData.icon = input.icon;
	if (input.basePoints !== undefined) updateData.basePoints = input.basePoints;
	if (input.triggerHint !== undefined) updateData.triggerHint = input.triggerHint;
	if (input.priority !== undefined) updateData.priority = input.priority;
	if (input.isMainQuest !== undefined) updateData.isMainQuest = input.isMainQuest;
	if (Object.keys(updateData).length === 0) {
		// no-op update — 既存行を返却
		const existing = await db
			.select()
			.from(childActivities)
			.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
			.get();
		return existing ? _toActivityShape(existing) : undefined;
	}
	const row = db
		.update(childActivities)
		.set(updateData)
		.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
		.returning()
		.get();
	return row ? _toActivityShape(row) : undefined;
}

/**
 * #1755 (#1709-A): 子供の今日の must 活動と達成状況を返す。
 */
export async function findMustActivitiesWithToday(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<{
	logged: number;
	total: number;
	activities: Array<{ id: number; name: string; icon: string; loggedToday: number }>;
}> {
	const mustList = await db
		.select({
			id: childActivities.id,
			name: childActivities.name,
			icon: childActivities.icon,
		})
		.from(childActivities)
		.where(
			and(
				eq(childActivities.childId, childId),
				eq(childActivities.priority, 'must'),
				eq(childActivities.isVisible, 1),
				or(eq(childActivities.isArchived, 0), isNull(childActivities.isArchived)),
			),
		)
		.orderBy(childActivities.sortOrder)
		.all();

	if (mustList.length === 0) {
		return { logged: 0, total: 0, activities: [] };
	}

	const todayLogs = await db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.recordedDate, today),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all();

	const loggedSet = new Set<number>(todayLogs.map((l) => l.activityId));
	const enriched = mustList.map((a) => ({
		id: a.id,
		name: a.name,
		icon: a.icon,
		loggedToday: loggedSet.has(a.id) ? 1 : 0,
	}));
	const logged = enriched.filter((a) => a.loggedToday === 1).length;
	return { logged, total: enriched.length, activities: enriched };
}

export async function setActivityVisibility(
	id: number,
	visible: boolean,
	tenantId: string,
): Promise<Activity | undefined> {
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	const row = db
		.update(childActivities)
		.set({ isVisible: visible ? 1 : 0 })
		.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
		.returning()
		.get();
	return row ? _toActivityShape(row) : undefined;
}

export async function deleteActivity(id: number, tenantId: string): Promise<Activity | undefined> {
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	const row = db
		.delete(childActivities)
		.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
		.returning()
		.get();
	return row ? _toActivityShape(row) : undefined;
}

// #783: archive / restore — child_activities 経由
export async function archiveActivities(
	ids: number[],
	reason: string,
	_tenantId: string,
): Promise<void> {
	if (ids.length === 0) return;
	db.update(childActivities)
		.set({ isArchived: 1, archivedReason: reason })
		.where(inArray(childActivities.id, ids))
		.run();
}

export async function restoreArchivedActivities(reason: string, _tenantId: string): Promise<void> {
	db.update(childActivities)
		.set({ isArchived: 0, archivedReason: null })
		.where(eq(childActivities.archivedReason, reason))
		.run();
}

export async function hasActivityLogs(activityId: number, _tenantId: string): Promise<boolean> {
	const result = await db
		.select({ cnt: count() })
		.from(activityLogs)
		.where(eq(activityLogs.activityId, activityId))
		.get();
	return (result?.cnt ?? 0) > 0;
}

export async function getActivityLogCounts(_tenantId: string): Promise<Record<number, number>> {
	const rows = await db
		.select({ activityId: activityLogs.activityId, cnt: count() })
		.from(activityLogs)
		.where(eq(activityLogs.cancelled, 0))
		.groupBy(activityLogs.activityId)
		.all();
	const result: Record<number, number> = {};
	for (const row of rows) {
		result[row.activityId] = row.cnt;
	}
	return result;
}

export async function deleteDailyMissionsByActivity(activityId: number, _tenantId: string) {
	db.delete(dailyMissions).where(eq(dailyMissions.activityId, activityId)).run();
}

// ============================================================
// Children
// ============================================================

export async function findChildById(id: number, _tenantId: string) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

// ============================================================
// Activity Logs
// ============================================================

export async function findDailyLog(
	childId: number,
	activityId: number,
	date: string,
	_tenantId: string,
) {
	return db
		.select()
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.activityId, activityId),
				eq(activityLogs.recordedDate, date),
				eq(activityLogs.cancelled, 0),
			),
		)
		.get();
}

export async function findStreakLogs(childId: number, activityId: number, _tenantId: string) {
	return db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.activityId, activityId),
				eq(activityLogs.cancelled, 0),
			),
		)
		.orderBy(desc(activityLogs.recordedDate))
		.all();
}

export async function insertActivityLog(
	input: {
		childId: number;
		activityId: number;
		points: number;
		streakDays: number;
		streakBonus: number;
		recordedDate: string;
		recordedAt: string;
	},
	_tenantId: string,
) {
	return db.insert(activityLogs).values(input).returning().get();
}

export async function findActivityLogById(id: number, _tenantId: string) {
	return db.select().from(activityLogs).where(eq(activityLogs.id, id)).get();
}

export async function markActivityLogCancelled(id: number, _tenantId: string) {
	db.update(activityLogs).set({ cancelled: 1 }).where(eq(activityLogs.id, id)).run();
}

export async function findActivityLogs(
	childId: number,
	_tenantId: string,
	options: { from?: string; to?: string } = {},
) {
	const conditions = [eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)];

	if (options.from) {
		conditions.push(gte(activityLogs.recordedDate, options.from));
	}
	if (options.to) {
		conditions.push(lte(activityLogs.recordedDate, options.to));
	}

	// #2362 PR-3 Phase 7b-2c: schema FK は child_activities に切替済 (Phase 7b-2a)
	return db
		.select({
			id: activityLogs.id,
			activityName: childActivities.name,
			activityIcon: childActivities.icon,
			categoryId: childActivities.categoryId,
			points: activityLogs.points,
			streakDays: activityLogs.streakDays,
			streakBonus: activityLogs.streakBonus,
			recordedAt: activityLogs.recordedAt,
		})
		.from(activityLogs)
		.innerJoin(childActivities, eq(activityLogs.activityId, childActivities.id))
		.where(and(...conditions))
		.orderBy(desc(activityLogs.recordedAt))
		.all();
}

export async function countTodayActiveRecords(
	childId: number,
	activityId: number,
	date: string,
	_tenantId: string,
): Promise<number> {
	const rows = await db
		.select()
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.activityId, activityId),
				eq(activityLogs.recordedDate, date),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all();
	return rows.length;
}

export async function getTodayActivityCountsByChild(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<{ activityId: number; count: number }[]> {
	return db
		.select({
			activityId: activityLogs.activityId,
			count: sql<number>`count(*)`.as('count'),
		})
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.recordedDate, date),
				eq(activityLogs.cancelled, 0),
			),
		)
		.groupBy(activityLogs.activityId)
		.all();
}

export async function findTodayRecordedActivityIds(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<number[]> {
	const rows = await db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.recordedDate, today),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all();

	return rows.map((r) => r.activityId);
}

// ============================================================
// Aggregation Queries (for achievement/title/combo services)
// ============================================================

/** 子供の活動記録日（重複除去・昇順）を取得 */
export async function findDistinctRecordedDates(
	childId: number,
	_tenantId: string,
): Promise<{ recordedDate: string }[]> {
	return db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.orderBy(activityLogs.recordedDate)
		.all();
}

/** 子供の累計活動記録数（キャンセル除外） */
export async function countActiveActivityLogs(childId: number, _tenantId: string): Promise<number> {
	const result = await db
		.select({ total: count() })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();
	return result?.total ?? 0;
}

/** 日別カテゴリ数を取得（achievement: all_categories 判定用） */
export async function getCategoryCountsByDate(
	childId: number,
	_tenantId: string,
): Promise<{ recordedDate: string; categoryCount: number }[]> {
	// #2458-A1: child_activities 経由 (旧 activities table の JOIN を撤去)
	return db
		.select({
			recordedDate: activityLogs.recordedDate,
			categoryCount: countDistinct(childActivities.categoryId),
		})
		.from(activityLogs)
		.innerJoin(childActivities, eq(activityLogs.activityId, childActivities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.all();
}

/** 累計で記録した異なるカテゴリ数 */
export async function countDistinctCategories(childId: number, _tenantId: string): Promise<number> {
	// #2458-A1: child_activities 経由
	const result = await db
		.select({ count: countDistinct(childActivities.categoryId) })
		.from(activityLogs)
		.innerJoin(childActivities, eq(activityLogs.activityId, childActivities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();
	return result?.count ?? 0;
}

/** 今日のログ（活動ID+カテゴリID付き）を取得（combo-service用） */
export async function findTodayLogsWithCategory(childId: number, date: string, _tenantId: string) {
	// #2362 PR-3 Phase 7b-2c: schema FK は child_activities に切替済 (Phase 7b-2a)
	return db
		.select({
			activityId: activityLogs.activityId,
			categoryId: childActivities.categoryId,
		})
		.from(activityLogs)
		.innerJoin(childActivities, eq(activityLogs.activityId, childActivities.id))
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.recordedDate, date),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all();
}

/** コンボボーナス既付与額を取得（combo-service用） */
export async function getComboPointsGranted(
	childId: number,
	descriptionPrefix: string,
	_tenantId: string,
): Promise<number> {
	const result = await db
		.select({
			total: sql<number>`coalesce(sum(amount), 0)`.as('total'),
		})
		.from(pointLedger)
		.where(
			and(
				eq(pointLedger.childId, childId),
				eq(pointLedger.type, 'combo_bonus'),
				sql`${pointLedger.description} LIKE ${`${descriptionPrefix}%`}`,
			),
		)
		.get();
	return result?.total ?? 0;
}

/** カテゴリ別の累計活動記録数（キャンセル除外） */
export async function countActiveActivityLogsByCategory(
	childId: number,
	categoryId: number,
	_tenantId: string,
): Promise<number> {
	// #2458-A1: child_activities 経由 (旧 activities table の JOIN を撤去)
	const result = await db
		.select({ total: count() })
		.from(activityLogs)
		.innerJoin(childActivities, eq(activityLogs.activityId, childActivities.id))
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.cancelled, 0),
				eq(childActivities.categoryId, categoryId),
			),
		)
		.get();
	return result?.total ?? 0;
}

/** 指定タイプのポイント台帳エントリ数を取得 */
export async function countPointLedgerEntriesByType(
	childId: number,
	type: string,
	_tenantId: string,
): Promise<number> {
	const result = await db
		.select({ total: count() })
		.from(pointLedger)
		.where(and(eq(pointLedger.childId, childId), eq(pointLedger.type, type)))
		.get();
	return result?.total ?? 0;
}

/** 指定タイプ＋日付のポイント台帳エントリ数を取得 */
export async function countPointLedgerEntriesByTypeAndDate(
	childId: number,
	type: string,
	date: string,
	_tenantId: string,
): Promise<number> {
	const result = await db
		.select({ total: count() })
		.from(pointLedger)
		.where(
			and(
				eq(pointLedger.childId, childId),
				eq(pointLedger.type, type),
				sql`date(${pointLedger.createdAt}) = ${date}`,
			),
		)
		.get();
	return result?.total ?? 0;
}

// ============================================================
// Point Ledger
// ============================================================

export async function insertPointLedger(
	input: {
		childId: number;
		amount: number;
		type: string;
		description: string;
		referenceId?: number;
	},
	_tenantId: string,
) {
	db.insert(pointLedger).values(input).run();
}

export async function countMainQuestActivities(_tenantId: string): Promise<number> {
	// #2458-A1: child_activities 経由 (tenant 全 child 横断、isVisible & isMainQuest フィルタ)
	const result = await db
		.select({ cnt: count() })
		.from(childActivities)
		.where(
			and(
				eq(childActivities.isMainQuest, 1),
				eq(childActivities.isVisible, 1),
				or(eq(childActivities.isArchived, 0), isNull(childActivities.isArchived)),
			),
		)
		.get();
	return result?.cnt ?? 0;
}

// ============================================================
// Retention cleanup (#717, #729)
// ============================================================

/**
 * 指定した子供の `recorded_date < cutoffDate` に該当する activity_logs を削除する。
 * cutoffDate は `YYYY-MM-DD` 形式で、その日自体は削除対象に含まない（strict less than）。
 */
export async function deleteActivityLogsBeforeDate(
	childId: number,
	cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	const result = db
		.delete(activityLogs)
		.where(and(eq(activityLogs.childId, childId), lt(activityLogs.recordedDate, cutoffDate)))
		.run();
	return result.changes;
}
