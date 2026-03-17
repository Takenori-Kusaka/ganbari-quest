// src/lib/server/db/activity-repo.ts
// 活動関連のリポジトリ層（DBアクセス）

import { and, count, countDistinct, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from './client';
import { activities, activityLogs, children, dailyMissions, pointLedger } from './schema';

// ============================================================
// Activity Filter
// ============================================================

export interface ActivityFilter {
	childAge?: number;
	categoryId?: number;
	includeHidden?: boolean;
}

export function findActivities(filter?: ActivityFilter) {
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

export function findActivityById(id: number) {
	return db.select().from(activities).where(eq(activities.id, id)).get();
}

export function insertActivity(input: {
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
}) {
	return db.insert(activities).values(input).returning().get();
}

export function updateActivity(
	id: number,
	input: Partial<{
		name: string;
		categoryId: number;
		icon: string;
		basePoints: number;
		ageMin: number | null;
		ageMax: number | null;
	}>,
) {
	return db.update(activities).set(input).where(eq(activities.id, id)).returning().get();
}

export function setActivityVisibility(id: number, visible: boolean) {
	return db
		.update(activities)
		.set({ isVisible: visible ? 1 : 0 })
		.where(eq(activities.id, id))
		.returning()
		.get();
}

export function deleteActivity(id: number) {
	return db.delete(activities).where(eq(activities.id, id)).returning().get();
}

export function hasActivityLogs(activityId: number): boolean {
	const result = db
		.select({ cnt: count() })
		.from(activityLogs)
		.where(eq(activityLogs.activityId, activityId))
		.get();
	return (result?.cnt ?? 0) > 0;
}

export function getActivityLogCounts(): Record<number, number> {
	const rows = db
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

export function deleteDailyMissionsByActivity(activityId: number) {
	db.delete(dailyMissions).where(eq(dailyMissions.activityId, activityId)).run();
}

// ============================================================
// Children
// ============================================================

export function findChildById(id: number) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

// ============================================================
// Activity Logs
// ============================================================

export function findDailyLog(childId: number, activityId: number, date: string) {
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

export function findStreakLogs(childId: number, activityId: number) {
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

export function insertActivityLog(input: {
	childId: number;
	activityId: number;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedDate: string;
	recordedAt: string;
}) {
	return db.insert(activityLogs).values(input).returning().get();
}

export function findActivityLogById(id: number) {
	return db.select().from(activityLogs).where(eq(activityLogs.id, id)).get();
}

export function markActivityLogCancelled(id: number) {
	db.update(activityLogs).set({ cancelled: 1 }).where(eq(activityLogs.id, id)).run();
}

export function findActivityLogs(childId: number, options: { from?: string; to?: string } = {}) {
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

export function countTodayActiveRecords(childId: number, activityId: number, date: string): number {
	const rows = db
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

export function getTodayActivityCountsByChild(
	childId: number,
	date: string,
): { activityId: number; count: number }[] {
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

export function findTodayRecordedActivityIds(childId: number, today: string): number[] {
	const rows = db
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
export function findDistinctRecordedDates(childId: number): { recordedDate: string }[] {
	return db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.orderBy(activityLogs.recordedDate)
		.all();
}

/** 子供の累計活動記録数（キャンセル除外） */
export function countActiveActivityLogs(childId: number): number {
	const result = db
		.select({ total: count() })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();
	return result?.total ?? 0;
}

/** 日別カテゴリ数を取得（achievement: all_categories 判定用） */
export function getCategoryCountsByDate(
	childId: number,
): { recordedDate: string; categoryCount: number }[] {
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
export function countDistinctCategories(childId: number): number {
	const result = db
		.select({ count: countDistinct(activities.categoryId) })
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.get();
	return result?.count ?? 0;
}

/** 今日のログ（活動ID+カテゴリID付き）を取得（combo-service用） */
export function findTodayLogsWithCategory(childId: number, date: string) {
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
export function getComboPointsGranted(childId: number, descriptionPrefix: string): number {
	const result = db
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

// ============================================================
// Point Ledger
// ============================================================

export function insertPointLedger(input: {
	childId: number;
	amount: number;
	type: string;
	description: string;
	referenceId?: number;
}) {
	db.insert(pointLedger).values(input).run();
}
