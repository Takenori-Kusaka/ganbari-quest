// Demo IActivityMasteryRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { ActivityMastery } from '../types';

export async function findByChildAndActivity(
	_childId: number,
	_activityId: number,
	_tenantId: string,
): Promise<ActivityMastery | undefined> {
	return undefined;
}

export async function findAllByChild(
	_childId: number,
	_tenantId: string,
): Promise<ActivityMastery[]> {
	return [];
}

export async function upsert(
	childId: number,
	activityId: number,
	totalCount: number,
	level: number,
	_tenantId: string,
): Promise<ActivityMastery> {
	// Stub: 受け取った値で minimal ActivityMastery を返す (interface 契約)
	return {
		id: 0,
		childId,
		activityId,
		totalCount,
		level,
		updatedAt: new Date().toISOString(),
	} as ActivityMastery;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
