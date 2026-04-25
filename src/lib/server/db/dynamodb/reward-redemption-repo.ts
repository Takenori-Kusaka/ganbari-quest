// src/lib/server/db/dynamodb/reward-redemption-repo.ts
// DynamoDB stub for IRewardRedemptionRepo (#1337)
// NOTE: DynamoDB backend is AWS Lambda production. Full implementation deferred (Lambda uses SQLite via EFS).

import type {
	IRewardRedemptionRepo,
	RedemptionRequestRow,
	RedemptionRequestWithDetails,
	RedemptionRequestWithReward,
} from '../interfaces/reward-redemption-repo.interface';

export const insertRedemptionRequest: IRewardRedemptionRepo['insertRedemptionRequest'] =
	async () => {
		throw new Error('reward-redemption-repo: DynamoDB not implemented');
	};

export const findRedemptionRequestsByChild: IRewardRedemptionRepo['findRedemptionRequestsByChild'] =
	async (): Promise<RedemptionRequestRow[]> => {
		return [];
	};

export const findRedemptionRequestsByTenant: IRewardRedemptionRepo['findRedemptionRequestsByTenant'] =
	async (): Promise<RedemptionRequestWithDetails[]> => {
		return [];
	};

export const updateRedemptionRequestStatus: IRewardRedemptionRepo['updateRedemptionRequestStatus'] =
	async () => {
		throw new Error('reward-redemption-repo: DynamoDB not implemented');
	};

export const findPendingByChildAndReward: IRewardRedemptionRepo['findPendingByChildAndReward'] =
	async (): Promise<RedemptionRequestRow | undefined> => {
		return undefined;
	};

export const findUnshownResultByChild: IRewardRedemptionRepo['findUnshownResultByChild'] =
	async (): Promise<RedemptionRequestWithReward | undefined> => {
		return undefined;
	};

export const markRedemptionResultShown: IRewardRedemptionRepo['markRedemptionResultShown'] =
	async () => {
		return undefined;
	};

export const expireOldRedemptions: IRewardRedemptionRepo['expireOldRedemptions'] =
	async (): Promise<number> => {
		return 0;
	};

export const hasPendingByReward: IRewardRedemptionRepo['hasPendingByReward'] =
	async (): Promise<boolean> => {
		return false;
	};

export const deleteByTenantId: IRewardRedemptionRepo['deleteByTenantId'] =
	async (): Promise<void> => {
		// no-op
	};
