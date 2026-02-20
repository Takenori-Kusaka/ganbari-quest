// src/lib/server/db/activity-repo.ts
// 活動関連のリポジトリ層（DBアクセス）

import { eq, and, lte, gte, or, isNull, desc } from 'drizzle-orm';
import { db } from './client';
import { activities, activityLogs, children, pointLedger } from './schema';
import type { Category } from '$lib/domain/validation/activity';

// ============================================================
// Activity Filter
// ============================================================

export interface ActivityFilter {
	childAge?: number;
	category?: Category;
	includeHidden?: boolean;
}

export function findActivities(filter?: ActivityFilter) {
	let query = db.select().from(activities).$dynamic();

	const conditions = [];

	if (filter?.category) {
		conditions.push(eq(activities.category, filter.category));
	}

	if (!filter?.includeHidden) {
		conditions.push(eq(activities.isVisible, 1));
	}

	if (filter?.childAge != null) {
		conditions.push(
			or(isNull(activities.ageMin), lte(activities.ageMin, filter.childAge)),
		);
		conditions.push(
			or(isNull(activities.ageMax), gte(activities.ageMax, filter.childAge)),
		);
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
	category: Category;
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
		category: Category;
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

export function findActivityLogs(
	childId: number,
	options: { from?: string; to?: string } = {},
) {
	const conditions = [
		eq(activityLogs.childId, childId),
		eq(activityLogs.cancelled, 0),
	];

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
			category: activities.category,
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
// Point Ledger
// ============================================================

export function insertPointLedger(input: {
	childId: number;
	amount: number;
	type: string;
	description: string;
	referenceId: number;
}) {
	db.insert(pointLedger).values(input).run();
}
