// Demo IRewardRedemptionRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	RedemptionRequestRow,
	RedemptionRequestWithDetails,
	RedemptionRequestWithReward,
} from '../interfaces/reward-redemption-repo.interface';

export async function insertRedemptionRequest(
	input: { childId: number; rewardId: number; requestedAt: number },
	_tenantId: string,
): Promise<RedemptionRequestRow> {
	return {
		id: 0,
		childId: input.childId,
		rewardId: input.rewardId,
		requestedAt: input.requestedAt,
		status: 'pending',
		parentNote: null,
		resolvedAt: null,
		resolvedByParentId: null,
		shownToChildAt: null,
	};
}

export async function findRedemptionRequestsByChild(
	_childId: number,
	_tenantId: string,
): Promise<RedemptionRequestRow[]> {
	return [];
}

export async function findRedemptionRequestsByTenant(
	_tenantId: string,
	_opts?: { status?: string; childId?: number; limit?: number },
): Promise<RedemptionRequestWithDetails[]> {
	return [];
}

export async function updateRedemptionRequestStatus(
	_id: number,
	_updates: {
		status: string;
		parentNote?: string | null;
		resolvedAt?: number | null;
		resolvedByParentId?: number | null;
	},
	_tenantId: string,
): Promise<RedemptionRequestRow | undefined> {
	return undefined;
}

export async function findPendingByChildAndReward(
	_childId: number,
	_rewardId: number,
	_tenantId: string,
): Promise<RedemptionRequestRow | undefined> {
	return undefined;
}

export async function findUnshownResultByChild(
	_childId: number,
	_tenantId: string,
): Promise<RedemptionRequestWithReward | undefined> {
	return undefined;
}

export async function markRedemptionResultShown(
	_id: number,
	_tenantId: string,
): Promise<RedemptionRequestRow | undefined> {
	return undefined;
}

export async function expireOldRedemptions(_tenantId: string): Promise<number> {
	return 0;
}

export async function hasPendingByReward(_rewardId: number, _tenantId: string): Promise<boolean> {
	return false;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
