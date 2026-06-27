// src/lib/server/services/reward-redemption-service.ts
// ごほうびショップ交換申請サービス (#1337)

import { findChildById, getBalance, insertPointEntry } from '$lib/server/db/point-repo';
import {
	countRedemptionRequestsByTenant,
	expireOldRedemptions as expireOldRedemptionsRepo,
	findPendingByChildAndReward,
	findRedemptionRequestsByChild,
	findRedemptionRequestsByTenant,
	findUnshownResultByChild,
	insertRedemptionRequest,
	markRedemptionResultShown,
	updateRedemptionRequestStatus,
} from '$lib/server/db/reward-redemption-repo';
import { getSetting } from '$lib/server/db/settings-repo';
import { findSpecialRewards } from '$lib/server/db/special-reward-repo';

/**
 * #3339: ごほうび交換の「即時交換（親承認スキップ）」が家庭設定で有効か。
 * settings KVS `reward_auto_approve`（既定 OFF = 現行の親承認フロー）。
 * sibling_ranking_enabled と同じ bool 規約（'true' のみ真）。
 */
export async function isRewardAutoApproveEnabled(tenantId: string): Promise<boolean> {
	return (await getSetting('reward_auto_approve', tenantId)) === 'true';
}

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
	/**
	 * #3339: 即時交換（家庭設定 `reward_auto_approve` ON）で親承認をスキップして
	 * その場で approved 確定したか。`requestRedemption` のみ設定する（承認/却下経路では undefined）。
	 */
	instant?: boolean;
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

	// 申請作成（repo は常に pending_parent_approval で作成する）
	const now = Math.floor(Date.now() / 1000);
	const row = await insertRedemptionRequest({ childId, rewardId, requestedAt: now }, tenantId);

	// #3339: 家庭設定で即時交換が有効なら、その場で承認確定（減算 + approved）し親承認をスキップする。
	// 既存の親承認と同一の finalizeApproval を共有するため減算・監査・status 更新の挙動は一致する
	// （resolvedByParentId=null = システム自動承認）。OFF（既定）なら従来どおり pending を返す。
	if (await isRewardAutoApproveEnabled(tenantId)) {
		const finalized = await finalizeApproval({
			childId,
			requestId: row.id,
			rewardPoints: reward.points,
			rewardTitle: reward.title,
			parentUserId: null,
			tenantId,
		});
		if ('error' in finalized) {
			// 残高は上で確認済だが、並行交換で不足した場合は INSUFFICIENT_POINTS を返す。
			// REQUEST_NOT_FOUND（直前 insert の取り違え）は理論上発生しないが安全側で REWARD_NOT_FOUND に倒す。
			return finalized.error === 'INSUFFICIENT_POINTS'
				? { error: 'INSUFFICIENT_POINTS' }
				: { error: 'REWARD_NOT_FOUND' };
		}
		return { ...finalized, instant: true };
	}

	return {
		id: row.id,
		childId: row.childId,
		rewardId: row.rewardId,
		status: row.status as RedemptionStatus,
		requestedAt: row.requestedAt,
		parentNote: row.parentNote,
		resolvedAt: row.resolvedAt,
		shownToChildAt: row.shownToChildAt,
		instant: false,
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

/**
 * #3144: テナント内の「親の承認待ち」ごほうび交換申請の件数を返す。
 * admin ホームの承認待ちバナー（発見性導線）で使う。
 * countRedemptionRequestsByTenant は limit を掛けず COUNT するため 50 件以上でも飽和しない
 * (findRedemptionRequestsByTenant の limit(50) 流用だと 51+ 件で過少カウントになる)。
 */
export async function countPendingRedemptionsForParent(tenantId: string): Promise<number> {
	return countRedemptionRequestsByTenant(tenantId, {
		status: 'pending_parent_approval',
	});
}

// ============================================================
// 承認
// ============================================================

export type ApproveError =
	| { error: 'INVALID_STATUS' }
	| { error: 'INSUFFICIENT_POINTS' }
	| { error: 'REQUEST_NOT_FOUND' };

/**
 * 申請を「承認 (approved)」に確定する共通処理（#3339 で抽出）。
 * 残高再確認（レース対策）→ ポイント減算 → status='approved' 更新を行う。
 * 親承認（{@link approveRedemption}）と即時交換（{@link requestRedemption} の auto-approve 経路）で共有する。
 *
 * @param parentUserId 承認した保護者の認証 userId。即時交換（システム自動承認）では null。
 */
async function finalizeApproval(args: {
	childId: number;
	requestId: number;
	rewardPoints: number;
	rewardTitle: string;
	parentUserId: string | null;
	tenantId: string;
}): Promise<RedemptionRequestResult | { error: 'INSUFFICIENT_POINTS' | 'REQUEST_NOT_FOUND' }> {
	const { childId, requestId, rewardPoints, rewardTitle, parentUserId, tenantId } = args;

	// ポイント残高再確認（レースコンディション対策）
	const balance = await getBalance(childId, tenantId);
	if (balance < rewardPoints) return { error: 'INSUFFICIENT_POINTS' };

	// ポイント減算
	await insertPointEntry(
		{
			childId,
			amount: -rewardPoints,
			type: 'reward_redemption',
			description: rewardTitle,
			referenceId: requestId,
		},
		tenantId,
	);

	// ステータス更新 (#2845 課題①: childId で所有権検証付き composite key 更新)
	const now = Math.floor(Date.now() / 1000);
	const updated = await updateRedemptionRequestStatus(
		childId,
		requestId,
		{
			status: 'approved',
			resolvedAt: now,
			resolvedByParentId: parentUserId,
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

export async function approveRedemption(
	requestId: number,
	// #3320: 承認した保護者の認証 userId (cognito sub 等)。監査証跡として記録する。
	// local 実行モード等で identity userId が無い場合は null (= 解決者不明)。
	parentUserId: string | null,
	tenantId: string,
): Promise<RedemptionRequestResult | ApproveError> {
	// 申請取得（テナント内か確認のため全件から検索）
	// children + specialRewards 結合で取得
	const allPending = await findRedemptionRequestsByTenant(tenantId);
	const req = allPending.find((r) => r.id === requestId);
	if (!req) return { error: 'REQUEST_NOT_FOUND' };

	if (req.status !== 'pending_parent_approval') return { error: 'INVALID_STATUS' };

	return finalizeApproval({
		childId: req.childId,
		requestId,
		rewardPoints: req.rewardPoints,
		rewardTitle: req.rewardTitle,
		parentUserId,
		tenantId,
	});
}

// ============================================================
// 却下
// ============================================================

export type RejectError = { error: 'INVALID_STATUS' } | { error: 'REQUEST_NOT_FOUND' };

export async function rejectRedemption(
	requestId: number,
	parentNote: string | null,
	tenantId: string,
	// #3320: 却下した保護者の認証 userId。承認と対称に監査証跡として記録する (null = 解決者不明)。
	parentUserId: string | null = null,
): Promise<RedemptionRequestResult | RejectError> {
	const allRequests = await findRedemptionRequestsByTenant(tenantId);
	const req = allRequests.find((r) => r.id === requestId);
	if (!req) return { error: 'REQUEST_NOT_FOUND' };

	if (req.status !== 'pending_parent_approval') return { error: 'INVALID_STATUS' };

	const now = Math.floor(Date.now() / 1000);
	// #2845 課題①: req.childId で所有権検証付き composite key 更新
	const updated = await updateRedemptionRequestStatus(
		req.childId,
		requestId,
		{
			status: 'rejected',
			parentNote: parentNote ? parentNote.slice(0, 100) : null,
			resolvedAt: now,
			resolvedByParentId: parentUserId,
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

/**
 * 未表示通知を表示済みにする。
 * #2845 課題①: childId 所有権検証付き (composite key)。不一致なら undefined。
 */
export async function markRedemptionShown(childId: number, id: number, tenantId: string) {
	return markRedemptionResultShown(childId, id, tenantId);
}
