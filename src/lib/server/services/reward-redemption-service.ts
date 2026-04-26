// src/lib/server/services/reward-redemption-service.ts
// ごほうびショップ交換申請サービス (#1337)

import { findChildById, getBalance, insertPointEntry } from '$lib/server/db/point-repo';
import {
	expireOldRedemptions as expireOldRedemptionsRepo,
	findPendingByChildAndReward,
	findRedemptionRequestsByChild,
	findRedemptionRequestsByTenant,
	findUnshownResultByChild,
	insertRedemptionRequest,
	markRedemptionResultShown,
	updateRedemptionRequestStatus,
} from '$lib/server/db/reward-redemption-repo';
import { findSpecialRewards } from '$lib/server/db/special-reward-repo';

// ============================================================
// 型定義
// ============================================================

export type RedemptionStatus = 'pending_parent_approval' | 'approved' | 'rejected' | 'expired';

export interface RedemptionRequestResult {
	id: number;
	childId: number;
	rewardId: number;
	status: RedemptionStatus;
	requestedAt: number;
	parentNote: string | null;
	resolvedAt: number | null;
	shownToChildAt: number | null;
}

export interface RedemptionRequestWithDetails {
	id: number;
	childId: number;
	childName: string;
	rewardId: number;
	rewardTitle: string;
	rewardIcon: string | null;
	rewardPoints: number;
	status: RedemptionStatus;
	requestedAt: number;
	parentNote: string | null;
	resolvedAt: number | null;
}

export interface UnshownRedemptionResult {
	id: number;
	childId: number;
	rewardId: number;
	rewardTitle: string;
	rewardIcon: string | null;
	status: 'approved' | 'rejected';
	parentNote: string | null;
}

// ============================================================
// 申請作成
// ============================================================

export type RequestRedemptionError =
	| { error: 'INSUFFICIENT_POINTS' }
	| { error: 'ALREADY_PENDING' }
	| { error: 'REWARD_NOT_FOUND' };

export async function requestRedemption(
	childId: number,
	rewardId: number,
	tenantId: string,
): Promise<RedemptionRequestResult | RequestRedemptionError> {
	// 報酬の存在確認（子供に紐付くか）
	const rewards = await findSpecialRewards(childId, tenantId);
	const reward = rewards.find((r) => r.id === rewardId);
	if (!reward) return { error: 'REWARD_NOT_FOUND' };

	// ポイント残高確認
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'REWARD_NOT_FOUND' };

	const balance = await getBalance(childId, tenantId);
	if (balance < reward.points) return { error: 'INSUFFICIENT_POINTS' };

	// 重複申請確認
	const existing = await findPendingByChildAndReward(childId, rewardId, tenantId);
	if (existing) return { error: 'ALREADY_PENDING' };

	// 申請作成
	const now = Math.floor(Date.now() / 1000);
	const row = await insertRedemptionRequest({ childId, rewardId, requestedAt: now }, tenantId);

	return {
		id: row.id,
		childId: row.childId,
		rewardId: row.rewardId,
		status: row.status as RedemptionStatus,
		requestedAt: row.requestedAt,
		parentNote: row.parentNote,
		resolvedAt: row.resolvedAt,
		shownToChildAt: row.shownToChildAt,
	};
}

// ============================================================
// 申請一覧取得（子供向け）
// ============================================================

export async function getRedemptionRequestsForChild(childId: number, tenantId: string) {
	return findRedemptionRequestsByChild(childId, tenantId);
}

// ============================================================
// 申請一覧取得（親向け）
// ============================================================

export async function getRedemptionRequestsForParent(
	tenantId: string,
	opts?: { status?: string; childId?: number; limit?: number },
) {
	const rows = await findRedemptionRequestsByTenant(tenantId, opts);
	return rows.map((r) => ({
		id: r.id,
		childId: r.childId,
		childName: r.childName,
		rewardId: r.rewardId,
		rewardTitle: r.rewardTitle,
		rewardIcon: r.rewardIcon,
		rewardPoints: r.rewardPoints,
		status: r.status as RedemptionStatus,
		requestedAt: r.requestedAt,
		parentNote: r.parentNote,
		resolvedAt: r.resolvedAt,
	}));
}

// ============================================================
// 承認
// ============================================================

export type ApproveError =
	| { error: 'INVALID_STATUS' }
	| { error: 'INSUFFICIENT_POINTS' }
	| { error: 'REQUEST_NOT_FOUND' };

export async function approveRedemption(
	requestId: number,
	parentId: number,
	tenantId: string,
): Promise<RedemptionRequestResult | ApproveError> {
	// 申請取得（テナント内か確認のため全件から検索）
	// children + specialRewards 結合で取得
	const allPending = await findRedemptionRequestsByTenant(tenantId);
	const req = allPending.find((r) => r.id === requestId);
	if (!req) return { error: 'REQUEST_NOT_FOUND' };

	if (req.status !== 'pending_parent_approval') return { error: 'INVALID_STATUS' };

	// ポイント残高再確認（レースコンディション対策）
	const balance = await getBalance(req.childId, tenantId);
	if (balance < req.rewardPoints) return { error: 'INSUFFICIENT_POINTS' };

	// ポイント減算
	await insertPointEntry(
		{
			childId: req.childId,
			amount: -req.rewardPoints,
			type: 'reward_redemption',
			description: req.rewardTitle,
			referenceId: requestId,
		},
		tenantId,
	);

	// ステータス更新
	const now = Math.floor(Date.now() / 1000);
	const updated = await updateRedemptionRequestStatus(
		requestId,
		{
			status: 'approved',
			resolvedAt: now,
			resolvedByParentId: parentId,
		},
		tenantId,
	);

	if (!updated) return { error: 'REQUEST_NOT_FOUND' };

	return {
		id: updated.id,
		childId: updated.childId,
		rewardId: updated.rewardId,
		status: updated.status as RedemptionStatus,
		requestedAt: updated.requestedAt,
		parentNote: updated.parentNote,
		resolvedAt: updated.resolvedAt,
		shownToChildAt: updated.shownToChildAt,
	};
}

// ============================================================
// 却下
// ============================================================

export type RejectError = { error: 'INVALID_STATUS' } | { error: 'REQUEST_NOT_FOUND' };

export async function rejectRedemption(
	requestId: number,
	parentNote: string | null,
	tenantId: string,
): Promise<RedemptionRequestResult | RejectError> {
	const allRequests = await findRedemptionRequestsByTenant(tenantId);
	const req = allRequests.find((r) => r.id === requestId);
	if (!req) return { error: 'REQUEST_NOT_FOUND' };

	if (req.status !== 'pending_parent_approval') return { error: 'INVALID_STATUS' };

	const now = Math.floor(Date.now() / 1000);
	const updated = await updateRedemptionRequestStatus(
		requestId,
		{
			status: 'rejected',
			parentNote: parentNote ? parentNote.slice(0, 100) : null,
			resolvedAt: now,
		},
		tenantId,
	);

	if (!updated) return { error: 'REQUEST_NOT_FOUND' };

	return {
		id: updated.id,
		childId: updated.childId,
		rewardId: updated.rewardId,
		status: updated.status as RedemptionStatus,
		requestedAt: updated.requestedAt,
		parentNote: updated.parentNote,
		resolvedAt: updated.resolvedAt,
		shownToChildAt: updated.shownToChildAt,
	};
}

// ============================================================
// 期限切れ処理（cron 用）
// ============================================================

export async function expireOldRedemptions(tenantId: string): Promise<number> {
	return expireOldRedemptionsRepo(tenantId);
}

// ============================================================
// 未表示通知取得（子供ホーム画面用）
// ============================================================

export async function getUnshownRedemptionResult(
	childId: number,
	tenantId: string,
): Promise<UnshownRedemptionResult | null> {
	const row = await findUnshownResultByChild(childId, tenantId);
	if (!row) return null;
	if (row.status !== 'approved' && row.status !== 'rejected') return null;

	return {
		id: row.id,
		childId: row.childId,
		rewardId: row.rewardId,
		rewardTitle: row.rewardTitle,
		rewardIcon: row.rewardIcon,
		status: row.status,
		parentNote: row.parentNote,
	};
}

/** 未表示通知を表示済みにする */
export async function markRedemptionShown(id: number, tenantId: string) {
	return markRedemptionResultShown(id, tenantId);
}
