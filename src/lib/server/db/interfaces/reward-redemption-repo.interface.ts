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

	findRedemptionRequestsByChild(childId: number, tenantId: string): Promise<RedemptionRequestRow[]>;

	findRedemptionRequestsByTenant(
		tenantId: string,
		opts?: { status?: string; childId?: number; limit?: number },
	): Promise<RedemptionRequestWithDetails[]>;

	/**
	 * #2845 課題①: full composite-key addressing。childId + id の複合キーで対象を直接
	 * 特定し、repo 入口で child 所有権を構造的に検証する。不一致なら undefined。
	 */
	updateRedemptionRequestStatus(
		childId: number,
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

	/** #2845 課題①: childId 所有権検証付き (composite key 直接特定)。不一致なら undefined。 */
	markRedemptionResultShown(
		childId: number,
		id: number,
		tenantId: string,
	): Promise<RedemptionRequestRow | undefined>;

	expireOldRedemptions(tenantId: string): Promise<number>;

	hasPendingByReward(rewardId: number, tenantId: string): Promise<boolean>;

	deleteByTenantId(tenantId: string): Promise<void>;
}
