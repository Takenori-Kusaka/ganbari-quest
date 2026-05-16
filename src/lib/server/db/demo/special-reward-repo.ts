// Demo ISpecialRewardRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { getDemoMarketplaceSpecialRewardsByChild } from '$lib/server/demo/demo-data';
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
	childId: number,
	_tenantId: string,
): Promise<SpecialReward[]> {
	// #2097 Phase B-7: marketplace reward-set 由来の pre-granted rewards を返す
	return getDemoMarketplaceSpecialRewardsByChild(childId);
}

export async function findUnshownReward(
	_childId: number,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	// 全 special rewards は shownAt=daysAgoISO(...) で「既読」扱い、新規 unshown はなし
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
