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
import {
	type ActivityId,
	asActivityId,
	asChildId,
	type CategoryId,
	type ChildId,
} from '$lib/domain/ids';
import { db } from '../client';
import { activityLogs, childActivities, childActivityPreferences } from '../schema';
import type { ActivityUsageCount, ChildActivityPreference } from '../types';

type PrefRow = typeof childActivityPreferences.$inferSelect;

const toEntity = (r: PrefRow): ChildActivityPreference => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	activityId: asActivityId(r.activityId),
});

/** #3329 backup: child の全活動設定 (pinned 不問。isPinned/pinOrder を round-trip 保全)。 */
export async function findAllByChild(
	childId: ChildId,
	_tenantId: string,
): Promise<ChildActivityPreference[]> {
	return db
		.select()
		.from(childActivityPreferences)
		.where(eq(childActivityPreferences.childId, Number(childId)))
		.orderBy(childActivityPreferences.pinOrder)
		.all()
		.map(toEntity);
}

/**
 * #3329 backup restore 用: isPinned/pinOrder/日時を保全して復元する (childId/activityId は呼び出し側が解決済)。
 * #3394/#3465 統一冪等契約: 同 (childId, activityId) 既存 (idx_child_activity_prefs_unique 衝突) は
 * onConflictDoNothing で skip し null を返す (DynamoDB attribute_not_exists と機能等価)。
 */
export async function insertForRestore(
	input: Omit<ChildActivityPreference, 'id'>,
	_tenantId: string,
): Promise<ChildActivityPreference | null> {
	const row = db
		.insert(childActivityPreferences)
		.values({
			childId: Number(input.childId),
			activityId: Number(input.activityId),
			isPinned: input.isPinned,
			pinOrder: input.pinOrder,
			createdAt: input.createdAt,
			updatedAt: input.updatedAt,
		})
		.onConflictDoNothing()
		.returning()
		.get();
	return row ? toEntity(row) : null;
}

export async function findPinnedByChild(
	childId: ChildId,
	_tenantId: string,
): Promise<ChildActivityPreference[]> {
	return db
		.select()
		.from(childActivityPreferences)
		.where(
			and(
				eq(childActivityPreferences.childId, Number(childId)),
				eq(childActivityPreferences.isPinned, 1),
			),
		)
		.orderBy(childActivityPreferences.pinOrder)
		.all()
		.map(toEntity);
}

export async function togglePin(
	childId: ChildId,
	activityId: ActivityId,
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
					eq(childActivityPreferences.childId, Number(childId)),
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
					eq(childActivityPreferences.childId, Number(childId)),
					eq(childActivityPreferences.activityId, Number(activityId)),
				),
			)
			.get();

		if (existing) {
			db.update(childActivityPreferences)
				.set({ isPinned: 1, pinOrder: nextOrder, updatedAt: now })
				.where(eq(childActivityPreferences.id, existing.id))
				.run();
			return { ...toEntity(existing), isPinned: 1, pinOrder: nextOrder, updatedAt: now };
		}

		const result = db
			.insert(childActivityPreferences)
			.values({
				childId: Number(childId),
				activityId: Number(activityId),
				isPinned: 1,
				pinOrder: nextOrder,
				createdAt: now,
				updatedAt: now,
			})
			.returning()
			.get();
		return toEntity(result);
	}

	// ピン留め解除
	const existing = db
		.select()
		.from(childActivityPreferences)
		.where(
			and(
				eq(childActivityPreferences.childId, Number(childId)),
				eq(childActivityPreferences.activityId, Number(activityId)),
			),
		)
		.get();

	if (existing) {
		db.update(childActivityPreferences)
			.set({ isPinned: 0, pinOrder: null, updatedAt: now })
			.where(eq(childActivityPreferences.id, existing.id))
			.run();
		return { ...toEntity(existing), isPinned: 0, pinOrder: null, updatedAt: now };
	}

	// 存在しない場合は isPinned=0 で作成
	const result = db
		.insert(childActivityPreferences)
		.values({
			childId: Number(childId),
			activityId: Number(activityId),
			isPinned: 0,
			pinOrder: null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get();
	return toEntity(result);
}

export async function countPinnedInCategory(
	childId: ChildId,
	categoryId: CategoryId,
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
				eq(childActivityPreferences.childId, Number(childId)),
				eq(childActivityPreferences.isPinned, 1),
				eq(childActivities.categoryId, Number(categoryId)),
			),
		)
		.get();
	return result?.count ?? 0;
}

export async function getUsageCounts(
	childId: ChildId,
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
				eq(activityLogs.childId, Number(childId)),
				gte(activityLogs.recordedDate, sinceDate),
				eq(activityLogs.cancelled, 0),
			),
		)
		.groupBy(activityLogs.activityId)
		.all()
		.map((r) => ({ activityId: asActivityId(r.activityId), usageCount: r.usageCount }));
}

/** テナントの全活動ピン留め設定を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(childActivityPreferences).run();
}
