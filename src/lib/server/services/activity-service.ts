import { eq, and, lte, gte, or, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { activities } from '$lib/server/db/schema';
import type { Category } from '$lib/domain/validation/activity';

export interface CreateActivityInput {
	name: string;
	category: Category;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
}

export interface ActivityFilter {
	childAge?: number;
	category?: Category;
	includeHidden?: boolean;
}

export function getActivities(filter?: ActivityFilter) {
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
