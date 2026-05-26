// src/lib/server/db/sqlite/activity-pref-repo.ts
// 子供×活動ピン留め設定リポジトリ（SQLite実装）
//
// #2458-C-1 (2026-05-26): countPinnedInCategory を旧 `activities` table JOIN から
// `child_activities` JOIN に migrate。これにより本 file は旧 `activities` table を
// 完全に参照しなくなり、#2458-C (旧 table physical drop) の制約条件を 1 件満たす。
//
// 設計:
//   - `childActivityPreferences.activityId` FK target は PR-3 (Phase 7b-2a) で既に
//     `childActivities.id` に切替済 (schema.ts L564-566)。旧 JOIN は活動 id を
//     `activities.id` と突合する integrity bug 状態だった。本 PR で正しい FK target
//     (`childActivities`) との JOIN に修正する。
//   - signature 不変 (caller `activity-pin-service.ts:50` は categoryId を渡すのみで
//     internal JOIN target に依存しない)。
//
// 関連:
//   - #2458 EPIC (旧 activities table drop)
//   - PR #2487 (#2458-A1 sqlite facade rewrite — write 0 化)
//   - ADR-0055 §3.1 per-child primary data model
//   - docs/design/data-model-resource-scope.md §4.1

import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { activityLogs, childActivities, childActivityPreferences } from '../schema';
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
	// #2458-C-1: childActivityPreferences.activityId は child_activities.id を参照する
	// (schema.ts L564-566、PR-3 Phase 7b-2a で FK target 切替済)。旧 JOIN は
	// `activities.id` 突合だったが、現状の FK semantics と integrity bug 状態を解消し、
	// 正しく child_activities と JOIN する。
	const result = db
		.select({ count: count() })
		.from(childActivityPreferences)
		.innerJoin(childActivities, eq(childActivityPreferences.activityId, childActivities.id))
		.where(
			and(
				eq(childActivityPreferences.childId, childId),
				eq(childActivityPreferences.isPinned, 1),
				eq(childActivities.categoryId, categoryId),
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
