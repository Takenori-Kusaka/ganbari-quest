import type { GradeLevel, Source } from '$lib/domain/validation/activity';
import { db } from '$lib/server/db';
import { activities, activityLogs, dailyMissions } from '$lib/server/db/schema';
import { and, count, eq, gte, isNull, lte, or } from 'drizzle-orm';

export interface CreateActivityInput {
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
	source?: Source;
	gradeLevel?: GradeLevel | null;
	subcategory?: string | null;
	description?: string | null;
	dailyLimit?: number | null;
	nameKana?: string | null;
	nameKanji?: string | null;
}

export interface ActivityFilter {
	childAge?: number;
	categoryId?: number;
	includeHidden?: boolean;
}

export function getActivities(filter?: ActivityFilter) {
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

export function getActivityById(id: number) {
	return db.select().from(activities).where(eq(activities.id, id)).get();
}

export function createActivity(input: CreateActivityInput) {
	return db.insert(activities).values(input).returning().get();
}

export function updateActivity(id: number, input: Partial<CreateActivityInput>) {
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

export function deleteActivityWithCleanup(id: number) {
	db.delete(dailyMissions).where(eq(dailyMissions.activityId, id)).run();
	return db.delete(activities).where(eq(activities.id, id)).returning().get();
}
