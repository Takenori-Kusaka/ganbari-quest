// src/lib/server/db/dynamodb/reward-redemption-repo.ts
// DynamoDB implementation of IRewardRedemptionRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// ごほうび交換機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type {
	IRewardRedemptionRepo,
	RedemptionRequestRow,
	RedemptionRequestWithDetails,
	RedemptionRequestWithReward,
} from '../interfaces/reward-redemption-repo.interface';

const SERVICE = 'reward-redemption-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export const insertRedemptionRequest: IRewardRedemptionRepo['insertRedemptionRequest'] = async (
	input,
	tenantId,
): Promise<RedemptionRequestRow> => {
	warnWrite('insertRedemptionRequest', {
		childId: input.childId,
		rewardId: input.rewardId,
		tenantId,
	});
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
};

export const findRedemptionRequestsByChild: IRewardRedemptionRepo['findRedemptionRequestsByChild'] =
	async (childId, tenantId): Promise<RedemptionRequestRow[]> => {
		warnRead('findRedemptionRequestsByChild', { childId, tenantId });
		return [];
	};

export const findRedemptionRequestsByTenant: IRewardRedemptionRepo['findRedemptionRequestsByTenant'] =
	async (tenantId, opts): Promise<RedemptionRequestWithDetails[]> => {
		warnRead('findRedemptionRequestsByTenant', { tenantId, opts });
		return [];
	};

export const updateRedemptionRequestStatus: IRewardRedemptionRepo['updateRedemptionRequestStatus'] =
	async (id, updates, tenantId): Promise<RedemptionRequestRow | undefined> => {
		warnWrite('updateRedemptionRequestStatus', { id, status: updates.status, tenantId });
		return undefined;
	};

export const findPendingByChildAndReward: IRewardRedemptionRepo['findPendingByChildAndReward'] =
	async (childId, rewardId, tenantId): Promise<RedemptionRequestRow | undefined> => {
		warnRead('findPendingByChildAndReward', { childId, rewardId, tenantId });
		return undefined;
	};

export const findUnshownResultByChild: IRewardRedemptionRepo['findUnshownResultByChild'] = async (
	childId,
	tenantId,
): Promise<RedemptionRequestWithReward | undefined> => {
	warnRead('findUnshownResultByChild', { childId, tenantId });
	return undefined;
};

export const markRedemptionResultShown: IRewardRedemptionRepo['markRedemptionResultShown'] = async (
	id,
	tenantId,
): Promise<RedemptionRequestRow | undefined> => {
	warnWrite('markRedemptionResultShown', { id, tenantId });
	return undefined;
};

export const expireOldRedemptions: IRewardRedemptionRepo['expireOldRedemptions'] = async (
	tenantId,
): Promise<number> => {
	warnWrite('expireOldRedemptions', { tenantId });
	return 0;
};

export const hasPendingByReward: IRewardRedemptionRepo['hasPendingByReward'] = async (
	rewardId,
	tenantId,
): Promise<boolean> => {
	warnRead('hasPendingByReward', { rewardId, tenantId });
	return false;
};

export const deleteByTenantId: IRewardRedemptionRepo['deleteByTenantId'] = async (
	tenantId,
): Promise<void> => {
	warnWrite('deleteByTenantId', { tenantId });
};
