// src/lib/server/db/activity-repo.ts
// 活動関連のリポジトリ層（DBアクセス）

import { and, count, countDistinct, desc, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { activities, activityLogs, children, dailyMissions, pointLedger } from '../schema';
import type { ActivityFilter } from '../types';

export async function findActivities(_tenantId: string, filter?: ActivityFilter) {
	let query = db.select().from(activities).$dynamic();

	const conditions = [];

	if (filter?.categoryId) {
		conditions.push(eq(activities.categoryId, filter.categoryId));
	}

	if (!filter?.includeHidden) {
		conditions.push(eq(activities.isVisible, 1));
	}

	if (filter?.childAge != null) {
		conditions.push(or(isNull(activities.ageMin), lte(activities.ageMin, filter.childAge)));
		conditions.push(or(isNull(activities.ageMax), gte(activities.ageMax, filter.childAge)));
	}

	if (conditions.length > 0) {
		query = query.where(and(...conditions));
	}

	return query.orderBy(activities.sortOrder).all();
}

export async function findActivityById(id: number, _tenantId: string) {
	return db.select().from(activities).where(eq(activities.id, id)).get();
}

export async function insertActivity(
	input: {
		name: string;
		categoryId: number;
		icon: string;
		basePoints: number;
		ageMin: number | null;
		ageMax: number | null;
		triggerHint?: string | null;
	},
	_tenantId: string,
) {
	return db.insert(activities).values(input).returning().get();
}

export async function updateActivity(
	id: number,
	input: Partial<{
		name: string;
		categoryId: number;
		icon: string;
		basePoints: number;
		ageMin: number | null;
		ageMax: number | null;
		triggerHint: string | null;
	}>,
	_tenantId: string,
) {
	return db.update(activities).set(input).where(eq(activities.id, id)).returning().get();
}

export async function setActivityVisibility(id: number, visible: boolean, _tenantId: string) {
	return db
		.update(activities)
		.set({ isVisible: visible ? 1 : 0 })
		.where(eq(activities.id, id))
		.returning()
		.get();
}

export async function deleteActivity(id: number, _tenantId: string) {
	return db.delete(activities).where(eq(activities.id, id)).returning().get();
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

	return db
		.select({
			id: activityLogs.id,
			activityName: activities.name,
			activityIcon: activities.icon,
			categoryId: activities.categoryId,
			points: activityLogs.points,
			streakDays: activityLogs.streakDays,
			streakBonus: activityLogs.streakBonus,
			recordedAt: activityLogs.recordedAt,
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
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
	return db
		.select({
			recordedDate: activityLogs.recordedDate,
			categoryCount: countDistinct(activities.categoryId),
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.all();
}

/** 累計で記録した異なるカテゴリ数 */
export async function countDistinctCategories(childId: number, _tenantId: string): Promise<number> {
	const result = await db
		.select({ count: countDistinct(activities.categoryId) })
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();
	return result?.count ?? 0;
}

/** 今日のログ（活動ID+カテゴリID付き）を取得（combo-service用） */
export async function findTodayLogsWithCategory(childId: number, date: string, _tenantId: string) {
	return db
		.select({
			activityId: activityLogs.activityId,
			categoryId: activities.categoryId,
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
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
	const result = await db
		.select({ total: count() })
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.cancelled, 0),
				eq(activities.categoryId, categoryId),
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
	const result = await db
		.select({ cnt: count() })
		.from(activities)
		.where(and(eq(activities.isMainQuest, 1), eq(activities.isVisible, 1)))
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
