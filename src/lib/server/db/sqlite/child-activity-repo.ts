// src/lib/server/db/sqlite/child-activity-repo.ts
// per-child activity instance repository — SQLite 実装 (#2362 PR-3, ADR-0055)
//
// 旧 `activity-repo.ts` (family master + age filter) の後継。
// `childId` 必須で cross-child access を構造的に防ぐ。
//
// tenant isolation について (#2494 Phase 1):
//   本実装の `_tenantId` 引数は意図的 no-op (SQLite は 1 process = 1 DB = 1 tenant で
//   tenant 越境入力が構造的に不能なため)。SSOT は
//   docs/design/data-model-resource-scope.md §4.1「tenant isolation の現状 SSOT」。
//   tenant_id 列追加 + filter (Phase 2) は #2828 で管理 (repo 層共通化に有用なら必須)。
//
// 並存原則 (Phase 2 段階): 旧 activities table は drop しない。
// Phase 6/7 で全 callsite 移行後に drop。

import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import type { ArchivedReason } from '$lib/domain/archive-types';
import { db } from '../client';
import { childActivities, children } from '../schema';
import type {
	Child,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '../types';

// ============================================================
// findActivitiesByChild — 指定 child の activity 一覧
// ============================================================

export async function findActivitiesByChild(
	childId: number,
	_tenantId: string,
	options?: { includeArchived?: boolean; visibleOnly?: boolean },
): Promise<ChildActivity[]> {
	const conditions = [eq(childActivities.childId, childId)];

	if (!options?.includeArchived) {
		// NULL 互換 (#962 教訓: NULL 既存行も active 扱い)
		const archivedFilter = or(
			eq(childActivities.isArchived, 0),
			isNull(childActivities.isArchived),
		);
		if (archivedFilter) {
			conditions.push(archivedFilter);
		}
	}

	if (options?.visibleOnly) {
		conditions.push(eq(childActivities.isVisible, 1));
	}

	return db
		.select()
		.from(childActivities)
		.where(and(...conditions))
		.orderBy(childActivities.sortOrder)
		.all();
}

// ============================================================
// findActivityById — id + child + tenant 3 軸取得
// ============================================================

export async function findActivityById(
	id: number,
	childId: number,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return db
		.select()
		.from(childActivities)
		.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
		.get();
}

// ============================================================
// countMainQuestActivities — per-child main quest 数
// ============================================================

export async function countMainQuestActivities(
	childId: number,
	_tenantId: string,
): Promise<number> {
	const result = await db
		.select({ cnt: count() })
		.from(childActivities)
		.where(
			and(
				eq(childActivities.childId, childId),
				eq(childActivities.isMainQuest, 1),
				eq(childActivities.isVisible, 1),
				or(eq(childActivities.isArchived, 0), isNull(childActivities.isArchived)),
			),
		)
		.get();
	return result?.cnt ?? 0;
}

// ============================================================
// insertActivity — per-child instance 新規作成
// ============================================================

export async function insertActivity(
	input: InsertChildActivityInput,
	_tenantId: string,
): Promise<ChildActivity> {
	const row = db
		.insert(childActivities)
		.values({
			childId: input.childId,
			name: input.name,
			categoryId: input.categoryId,
			icon: input.icon,
			basePoints: input.basePoints,
			triggerHint: input.triggerHint ?? null,
			isMainQuest: input.isMainQuest ?? 0,
			sourcePresetId: input.sourcePresetId ?? null,
			priority: input.priority ?? 'optional',
		})
		.returning()
		.get();
	if (!row) {
		throw new Error('insertActivity: insert returned no row');
	}
	return row;
}

// ============================================================
// insertActivitiesBulk — 一括作成 (取込時 per-child 配信)
// ============================================================
//
// 同一 source preset を複数 child に同時 instance 化する用途 (User §1
// 兄弟共通化 UX「一括追加」)。SQLite では `INSERT ... VALUES (...), (...)`
// が無いため for-loop で行うが、driver 側で transaction batching が効く。

export async function insertActivitiesBulk(
	inputs: InsertChildActivityInput[],
	tenantId: string,
): Promise<ChildActivity[]> {
	if (inputs.length === 0) return [];
	const results: ChildActivity[] = [];
	for (const input of inputs) {
		const row = await insertActivity(input, tenantId);
		results.push(row);
	}
	return results;
}

// ============================================================
// updateActivity — child scope 更新
// ============================================================

export async function updateActivity(
	id: number,
	childId: number,
	input: UpdateChildActivityInput,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return db
		.update(childActivities)
		.set(input)
		.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
		.returning()
		.get();
}

// ============================================================
// setActivityVisibility
// ============================================================

export async function setActivityVisibility(
	id: number,
	childId: number,
	visible: boolean,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return db
		.update(childActivities)
		.set({ isVisible: visible ? 1 : 0 })
		.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
		.returning()
		.get();
}

// ============================================================
// deleteActivity — child scope 削除
// ============================================================

export async function deleteActivity(
	id: number,
	childId: number,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return db
		.delete(childActivities)
		.where(and(eq(childActivities.id, id), eq(childActivities.childId, childId)))
		.returning()
		.get();
}

// ============================================================
// copyActivitiesAcrossChildren — 兄弟共通化 (User §1)
// ============================================================
//
// source child の activity 全件 (isArchived=0) を target child に複製。
// id / createdAt は新規採番、childId のみ差し替え。

export async function copyActivitiesAcrossChildren(
	sourceChildId: number,
	targetChildId: number,
	tenantId: string,
): Promise<ChildActivity[]> {
	const sourceActivities = await findActivitiesByChild(sourceChildId, tenantId, {
		includeArchived: false,
		visibleOnly: false,
	});

	if (sourceActivities.length === 0) return [];

	const inputs: InsertChildActivityInput[] = sourceActivities.map((a) => ({
		childId: targetChildId,
		name: a.name,
		categoryId: a.categoryId,
		icon: a.icon,
		basePoints: a.basePoints,
		triggerHint: a.triggerHint,
		isMainQuest: a.isMainQuest,
		sourcePresetId: a.sourcePresetId,
		priority: a.priority,
	}));

	return insertActivitiesBulk(inputs, tenantId);
}

// ============================================================
// archive / restore (#783)
// Phase 7 PR-2a (#2688): reason 引数を `ArchivedReason` 型に強制 (PR-1 #2685 で配備済の
// `ARCHIVED_REASONS` SSOT integration)。schema.ts L79 の enum 制約と同期で型安全担保。
// ============================================================

export async function archiveActivities(
	ids: number[],
	reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	if (ids.length === 0) return;
	db.update(childActivities)
		.set({ isArchived: 1, archivedReason: reason })
		.where(inArray(childActivities.id, ids))
		.run();
}

export async function restoreArchivedActivities(
	reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	db.update(childActivities)
		.set({ isArchived: 0, archivedReason: null })
		.where(eq(childActivities.archivedReason, reason))
		.run();
}

// ============================================================
// Child convenience lookup (existing pattern from activity-repo.ts)
// ============================================================

export async function findChildById(id: number, _tenantId: string): Promise<Child | undefined> {
	return db.select().from(children).where(eq(children.id, id)).get();
}
