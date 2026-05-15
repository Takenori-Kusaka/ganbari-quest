// Demo ISpecialRewardRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { InsertSpecialRewardInput, SpecialReward } from '../types';

export async function insertSpecialReward(
	input: InsertSpecialRewardInput,
	_tenantId: string,
): Promise<SpecialReward> {
	return {
		id: 0,
		childId: input.childId,
		grantedBy: input.grantedBy ?? null,
		title: input.title,
		description: input.description ?? null,
		points: input.points,
		icon: input.icon ?? null,
		category: input.category,
		grantedAt: new Date().toISOString(),
		shownAt: null,
		sourcePresetId: input.sourcePresetId ?? null,
	};
}

export async function findSpecialRewards(
	_childId: number,
	_tenantId: string,
): Promise<SpecialReward[]> {
	return [];
}

export async function findUnshownReward(
	_childId: number,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	return undefined;
}

export async function markRewardShown(
	_rewardId: number,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	return undefined;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
