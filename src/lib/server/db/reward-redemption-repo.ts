// src/lib/server/db/reward-redemption-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function insertRedemptionRequest(
	input: { childId: number; rewardId: number; requestedAt: number },
	tenantId: string,
) {
	return getRepos().rewardRedemption.insertRedemptionRequest(input, tenantId);
}

export async function findRedemptionRequestsByChild(childId: number, tenantId: string) {
	return getRepos().rewardRedemption.findRedemptionRequestsByChild(childId, tenantId);
}

export async function findRedemptionRequestsByTenant(
	tenantId: string,
	opts?: { status?: string; childId?: number; limit?: number },
) {
	return getRepos().rewardRedemption.findRedemptionRequestsByTenant(tenantId, opts);
}

export async function updateRedemptionRequestStatus(
	id: number,
	updates: {
		status: string;
		parentNote?: string | null;
		resolvedAt?: number | null;
		resolvedByParentId?: number | null;
	},
	tenantId: string,
) {
	return getRepos().rewardRedemption.updateRedemptionRequestStatus(id, updates, tenantId);
}

export async function findPendingByChildAndReward(
	childId: number,
	rewardId: number,
	tenantId: string,
) {
	return getRepos().rewardRedemption.findPendingByChildAndReward(childId, rewardId, tenantId);
}

export async function findUnshownResultByChild(childId: number, tenantId: string) {
	return getRepos().rewardRedemption.findUnshownResultByChild(childId, tenantId);
}

export async function markRedemptionResultShown(id: number, tenantId: string) {
	return getRepos().rewardRedemption.markRedemptionResultShown(id, tenantId);
}

export async function expireOldRedemptions(tenantId: string) {
	return getRepos().rewardRedemption.expireOldRedemptions(tenantId);
}

export async function hasPendingByReward(rewardId: number, tenantId: string) {
	return getRepos().rewardRedemption.hasPendingByReward(rewardId, tenantId);
}
