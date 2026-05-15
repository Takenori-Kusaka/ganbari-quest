// Demo IActivityPrefRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { ActivityUsageCount, ChildActivityPreference } from '../types';

export async function findPinnedByChild(
	_childId: number,
	_tenantId: string,
): Promise<ChildActivityPreference[]> {
	return [];
}

export async function togglePin(
	childId: number,
	activityId: number,
	pinned: boolean,
	_tenantId: string,
): Promise<ChildActivityPreference> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId,
		activityId,
		isPinned: pinned ? 1 : 0,
		pinOrder: pinned ? 0 : null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function countPinnedInCategory(
	_childId: number,
	_categoryId: number,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function getUsageCounts(
	_childId: number,
	_sinceDate: string,
	_tenantId: string,
): Promise<ActivityUsageCount[]> {
	return [];
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
