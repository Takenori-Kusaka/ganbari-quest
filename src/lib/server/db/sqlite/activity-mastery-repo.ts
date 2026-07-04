// src/lib/server/db/sqlite/activity-mastery-repo.ts
// 活動習熟度リポジトリ（SQLite実装）

import { type ActivityId, type ChildId, asActivityId, asChildId } from '$lib/domain/ids';
import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { activityMastery } from '../schema';
import type { ActivityMastery } from '../types';

type Row = typeof activityMastery.$inferSelect;

const toEntity = (r: Row): ActivityMastery => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	activityId: asActivityId(r.activityId),
});

export async function findByChildAndActivity(
	childId: ChildId,
	activityId: ActivityId,
	_tenantId: string,
): Promise<ActivityMastery | undefined> {
	const row = db
		.select()
		.from(activityMastery)
		.where(
			and(
				eq(activityMastery.childId, Number(childId)),
				eq(activityMastery.activityId, Number(activityId)),
			),
		)
		.get();
	return row ? toEntity(row) : undefined;
}

export async function findAllByChild(
	childId: ChildId,
	_tenantId: string,
): Promise<ActivityMastery[]> {
	return db
		.select()
		.from(activityMastery)
		.where(eq(activityMastery.childId, Number(childId)))
		.all()
		.map(toEntity);
}

export async function upsert(
	childId: ChildId,
	activityId: ActivityId,
	totalCount: number,
	level: number,
	_tenantId: string,
): Promise<ActivityMastery> {
	const now = new Date().toISOString();
	const existing = await findByChildAndActivity(childId, activityId, _tenantId);

	if (existing) {
		db.update(activityMastery)
			.set({ totalCount, level, updatedAt: now })
			.where(eq(activityMastery.id, Number(existing.id)))
			.run();
		return { ...existing, totalCount, level, updatedAt: now };
	}

	const inserted = db
		.insert(activityMastery)
		.values({
			childId: Number(childId),
			activityId: Number(activityId),
			totalCount,
			level,
			updatedAt: now,
		})
		.returning()
		.get();
	return toEntity(inserted);
}

/** テナントの全活動習熟度を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(activityMastery).run();
}
