// src/lib/server/db/demo/child-activity-repo.ts
// per-child activity instance repository — Demo Lambda 実装 (#2362 PR-3, ADR-0055)
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
//
// Phase 6 段階: per-child fixture `DEMO_CHILD_ACTIVITIES` を優先参照する。
// DEMO_CHILD_ACTIVITIES に該当 child のエントリが無い場合は、後方互換のため
// 旧 master DEMO_ACTIVITIES を per-child 視点で投影する legacy fallback を維持。
// Phase 7 で旧 master fallback を撤去予定。

import type { ArchivedReason } from '$lib/domain/archive-types';
import {
	DEMO_ACTIVITIES,
	DEMO_CHILD_ACTIVITIES,
	DEMO_CHILDREN,
	DEMO_MARKETPLACE_ACTIVITIES,
} from '$lib/server/demo/demo-data';
import type {
	Activity,
	Child,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '../types';

/**
 * 旧 master Activity を per-child 視点の ChildActivity 形に投影する。
 * id 衝突を避けるため `child_id * 1_000_000 + activity_id` で擬似 id を生成。
 * 取込元 master id は sourcePresetId に "demo:<originalId>" として保持。
 */
function projectToChildActivity(master: Activity, childId: number): ChildActivity {
	return {
		id: childId * 1_000_000 + master.id,
		childId,
		name: master.name,
		categoryId: master.categoryId,
		icon: master.icon,
		basePoints: master.basePoints,
		isVisible: master.isVisible,
		dailyLimit: master.dailyLimit,
		sortOrder: master.sortOrder,
		source: master.source,
		nameKana: master.nameKana,
		nameKanji: master.nameKanji,
		triggerHint: master.triggerHint,
		isMainQuest: master.isMainQuest,
		isArchived: master.isArchived,
		archivedReason: master.archivedReason,
		createdAt: master.createdAt,
		sourcePresetId: master.sourcePresetId ?? `demo:${master.id}`,
		priority: master.priority,
	};
}

const ALL_DEMO_ACTIVITIES_MASTER: Activity[] = (() => {
	const byName = new Map<string, Activity>();
	for (const a of DEMO_ACTIVITIES) {
		byName.set(a.name, a);
	}
	for (const a of DEMO_MARKETPLACE_ACTIVITIES) {
		if (!byName.has(a.name)) {
			byName.set(a.name, a);
		}
	}
	return Array.from(byName.values());
})();

// ============================================================
// Read (Fake)
// ============================================================

export async function findActivitiesByChild(
	childId: number,
	_tenantId: string,
	options?: { includeArchived?: boolean; visibleOnly?: boolean },
): Promise<ChildActivity[]> {
	// Phase 6: DEMO_CHILD_ACTIVITIES per-child fixture を優先参照
	const perChildList = DEMO_CHILD_ACTIVITIES.filter((a) => {
		if (a.childId !== childId) return false;
		if (!options?.includeArchived && a.isArchived === 1) return false;
		if (options?.visibleOnly && a.isVisible !== 1) return false;
		return true;
	});

	if (perChildList.length > 0) {
		return perChildList.slice().sort((a, b) => a.sortOrder - b.sortOrder);
	}

	// Legacy fallback: 旧 master を per-child 投影 (Phase 7 で撤去予定)
	return ALL_DEMO_ACTIVITIES_MASTER.filter((master) => {
		if (!options?.includeArchived && master.isArchived === 1) return false;
		if (options?.visibleOnly && master.isVisible !== 1) return false;
		return true;
	}).map((master) => projectToChildActivity(master, childId));
}

export async function findActivityById(
	id: number,
	childId: number,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	// Phase 6: per-child fixture を優先確認
	const perChild = DEMO_CHILD_ACTIVITIES.find((a) => a.id === id && a.childId === childId);
	if (perChild) return perChild;

	// Legacy fallback: 旧 master id 体系 (childId * 1_000_000 + masterId)
	const masterId = id - childId * 1_000_000;
	const master = ALL_DEMO_ACTIVITIES_MASTER.find((a) => a.id === masterId);
	return master ? projectToChildActivity(master, childId) : undefined;
}

export async function countMainQuestActivities(childId: number, tenantId: string): Promise<number> {
	const list = await findActivitiesByChild(childId, tenantId, { visibleOnly: true });
	return list.filter((a) => a.isMainQuest === 1).length;
}

// ============================================================
// Write (Stub no-op)
// ============================================================

export async function insertActivity(
	input: InsertChildActivityInput,
	_tenantId: string,
): Promise<ChildActivity> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		name: input.name,
		categoryId: input.categoryId,
		icon: input.icon,
		basePoints: input.basePoints,
		// #3358: round-trip 復元時の表示状態 / 並び順 / アーカイブ状態を保全 (省略時 schema default)
		isVisible: input.isVisible ?? 1,
		// #3422: 親入力の 1 日上限 / 読み仮名 / 漢字表記を persist (旧実装は null 固定で drop していた)
		dailyLimit: input.dailyLimit ?? null,
		sortOrder: input.sortOrder ?? 0,
		source: 'demo',
		nameKana: input.nameKana ?? null,
		nameKanji: input.nameKanji ?? null,
		triggerHint: input.triggerHint ?? null,
		isMainQuest: input.isMainQuest ?? 0,
		isArchived: input.isArchived ?? 0,
		archivedReason: input.archivedReason ?? null,
		createdAt: now,
		sourcePresetId: input.sourcePresetId ?? null,
		priority: input.priority ?? 'optional',
	};
}

export async function insertActivitiesBulk(
	inputs: InsertChildActivityInput[],
	tenantId: string,
): Promise<ChildActivity[]> {
	const out: ChildActivity[] = [];
	for (const input of inputs) {
		out.push(await insertActivity(input, tenantId));
	}
	return out;
}

export async function updateActivity(
	id: number,
	childId: number,
	_input: UpdateChildActivityInput,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	return findActivityById(id, childId, tenantId);
}

export async function setActivityVisibility(
	id: number,
	childId: number,
	_visible: boolean,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	return findActivityById(id, childId, tenantId);
}

export async function deleteActivity(
	id: number,
	childId: number,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	return findActivityById(id, childId, tenantId);
}

export async function copyActivitiesAcrossChildren(
	sourceChildId: number,
	targetChildId: number,
	tenantId: string,
): Promise<ChildActivity[]> {
	const sourceList = await findActivitiesByChild(sourceChildId, tenantId, {
		includeArchived: false,
		visibleOnly: false,
	});
	// Stub: source の活動を targetChildId 視点に投影して返すのみ (write は no-op)
	return sourceList.map((a) => ({ ...a, childId: targetChildId }));
}

// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveActivities(
	_ids: number[],
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function restoreArchivedActivities(
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

// ============================================================
// Child convenience lookup
// ============================================================

export async function findChildById(id: number, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}
