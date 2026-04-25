// src/lib/server/db/interfaces/reward-redemption-repo.interface.ts

export interface RedemptionRequestRow {
	id: number;
	childId: number;
	rewardId: number;
	requestedAt: number;
	status: string;
	parentNote: string | null;
	resolvedAt: number | null;
	resolvedByParentId: number | null;
	shownToChildAt: number | null;
}

export interface RedemptionRequestWithDetails extends RedemptionRequestRow {
	childName: string;
	rewardTitle: string;
	rewardIcon: string | null;
	rewardPoints: number;
}

export interface RedemptionRequestWithReward extends RedemptionRequestRow {
	rewardTitle: string;
	rewardIcon: string | null;
}

export interface IRewardRedemptionRepo {
	insertRedemptionRequest(
		input: { childId: number; rewardId: number; requestedAt: number },
		tenantId: string,
	): Promise<RedemptionRequestRow>;

	findRedemptionRequestsByChild(
		childId: number,
		tenantId: string,
	): Promise<RedemptionRequestRow[]>;

	findRedemptionRequestsByTenant(
		tenantId: string,
		opts?: { status?: string; childId?: number; limit?: number },
	): Promise<RedemptionRequestWithDetails[]>;

	updateRedemptionRequestStatus(
		id: number,
		updates: {
			status: string;
			parentNote?: string | null;
			resolvedAt?: number | null;
			resolvedByParentId?: number | null;
		},
		tenantId: string,
	): Promise<RedemptionRequestRow | undefined>;

	findPendingByChildAndReward(
		childId: number,
		rewardId: number,
		tenantId: string,
	): Promise<RedemptionRequestRow | undefined>;

	findUnshownResultByChild(
		childId: number,
		tenantId: string,
	): Promise<RedemptionRequestWithReward | undefined>;

	markRedemptionResultShown(
		id: number,
		tenantId: string,
	): Promise<RedemptionRequestRow | undefined>;

	expireOldRedemptions(tenantId: string): Promise<number>;

	hasPendingByReward(rewardId: number, tenantId: string): Promise<boolean>;

	deleteByTenantId(tenantId: string): Promise<void>;
}
