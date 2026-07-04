import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
// Demo IActivityPrefRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { ActivityUsageCount, ChildActivityPreference } from '../types';

export async function findAllByChild(
	_childId: ChildId,
	_tenantId: string,
): Promise<ChildActivityPreference[]> {
	return [];
}

export async function insertForRestore(
	input: Omit<ChildActivityPreference, 'id'>,
	_tenantId: string,
): Promise<ChildActivityPreference> {
	// Stub: demo は書き込み no-op。引数の状態を反映した row を返す。
	return { ...input, id: '0' };
}

export async function findPinnedByChild(
	_childId: ChildId,
	_tenantId: string,
): Promise<ChildActivityPreference[]> {
	return [];
}

export async function togglePin(
	childId: ChildId,
	activityId: ActivityId,
	pinned: boolean,
	_tenantId: string,
): Promise<ChildActivityPreference> {
	const now = new Date().toISOString();
	return {
		id: '0',
		childId,
		activityId,
		isPinned: pinned ? 1 : 0,
		pinOrder: pinned ? 0 : null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function countPinnedInCategory(
	_childId: ChildId,
	_categoryId: CategoryId,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function getUsageCounts(
	_childId: ChildId,
	_sinceDate: string,
	_tenantId: string,
): Promise<ActivityUsageCount[]> {
	return [];
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
