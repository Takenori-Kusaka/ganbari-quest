// src/lib/server/db/sqlite/activity-pref-repo.ts
// 子供×活動ピン留め設定リポジトリ（SQLite実装）

import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { activities, activityLogs, childActivityPreferences } from '../schema';
import type { ActivityUsageCount, ChildActivityPreference } from '../types';

export async function findPinnedByChild(
	childId: number,
	_tenantId: string,
): Promise<ChildActivityPreference[]> {
	return db
		.select()
		.from(childActivityPreferences)
		.where(
			and(eq(childActivityPreferences.childId, childId), eq(childActivityPreferences.isPinned, 1)),
		)
		.orderBy(childActivityPreferences.pinOrder)
		.all();
}

export async function togglePin(
	childId: number,
	activityId: number,
	pinned: boolean,
	_tenantId: string,
): Promise<ChildActivityPreference> {
	const now = new Date().toISOString();
	if (pinned) {
		// ピン留め: upsert
		const maxOrder = db
			.select({ max: sql<number>`COALESCE(MAX(pin_order), 0)` })
			.from(childActivityPreferences)
			.where(
				and(
					eq(childActivityPreferences.childId, childId),
					eq(childActivityPreferences.isPinned, 1),
				),
			)
			.get();
		const nextOrder = (maxOrder?.max ?? 0) + 1;

		const existing = db
			.select()
			.from(childActivityPreferences)
			.where(
				and(
					eq(childActivityPreferences.childId, childId),
					eq(childActivityPreferences.activityId, activityId),
				),
			)
			.get();

		if (existing) {
			db.update(childActivityPreferences)
				.set({ isPinned: 1, pinOrder: nextOrder, updatedAt: now })
				.where(eq(childActivityPreferences.id, existing.id))
				.run();
			return { ...existing, isPinned: 1, pinOrder: nextOrder, updatedAt: now };
		}

		const result = db
			.insert(childActivityPreferences)
			.values({
				childId,
				activityId,
				isPinned: 1,
				pinOrder: nextOrder,
				createdAt: now,
				updatedAt: now,
			})
			.returning()
			.get();
		return result;
	}

	// ピン留め解除
	const existing = db
		.select()
		.from(childActivityPreferences)
		.where(
			and(
				eq(childActivityPreferences.childId, childId),
				eq(childActivityPreferences.activityId, activityId),
			),
		)
		.get();

	if (existing) {
		db.update(childActivityPreferences)
			.set({ isPinned: 0, pinOrder: null, updatedAt: now })
			.where(eq(childActivityPreferences.id, existing.id))
			.run();
		return { ...existing, isPinned: 0, pinOrder: null, updatedAt: now };
	}

	// 存在しない場合は isPinned=0 で作成
	const result = db
		.insert(childActivityPreferences)
		.values({ childId, activityId, isPinned: 0, pinOrder: null, createdAt: now, updatedAt: now })
		.returning()
		.get();
	return result;
}

export async function countPinnedInCategory(
	childId: number,
	categoryId: number,
	_tenantId: string,
): Promise<number> {
	const result = db
		.select({ count: count() })
		.from(childActivityPreferences)
		.innerJoin(activities, eq(childActivityPreferences.activityId, activities.id))
		.where(
			and(
				eq(childActivityPreferences.childId, childId),
				eq(childActivityPreferences.isPinned, 1),
				eq(activities.categoryId, categoryId),
			),
		)
		.get();
	return result?.count ?? 0;
}

export async function getUsageCounts(
	childId: number,
	sinceDate: string,
	_tenantId: string,
): Promise<ActivityUsageCount[]> {
	return db
		.select({
			activityId: activityLogs.activityId,
			usageCount: count(),
		})
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				gte(activityLogs.recordedDate, sinceDate),
				eq(activityLogs.cancelled, 0),
			),
		)
		.groupBy(activityLogs.activityId)
		.all();
}

/** テナントの全活動ピン留め設定を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(childActivityPreferences).run();
}
