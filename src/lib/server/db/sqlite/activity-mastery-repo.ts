// src/lib/server/db/sqlite/activity-mastery-repo.ts
// 活動習熟度リポジトリ（SQLite実装）

import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { activityMastery } from '../schema';
import type { ActivityMastery } from '../types';

export async function findByChildAndActivity(
	childId: number,
	activityId: number,
	_tenantId: string,
): Promise<ActivityMastery | undefined> {
	return db
		.select()
		.from(activityMastery)
		.where(and(eq(activityMastery.childId, childId), eq(activityMastery.activityId, activityId)))
		.get();
}

export async function findAllByChild(
	childId: number,
	_tenantId: string,
): Promise<ActivityMastery[]> {
	return db.select().from(activityMastery).where(eq(activityMastery.childId, childId)).all();
}

export async function upsert(
	childId: number,
	activityId: number,
	totalCount: number,
	level: number,
	_tenantId: string,
): Promise<ActivityMastery> {
	const now = new Date().toISOString();
	const existing = await findByChildAndActivity(childId, activityId, _tenantId);

	if (existing) {
		db.update(activityMastery)
			.set({ totalCount, level, updatedAt: now })
			.where(eq(activityMastery.id, existing.id))
			.run();
		return { ...existing, totalCount, level, updatedAt: now };
	}

	return db
		.insert(activityMastery)
		.values({ childId, activityId, totalCount, level, updatedAt: now })
		.returning()
		.get();
}
