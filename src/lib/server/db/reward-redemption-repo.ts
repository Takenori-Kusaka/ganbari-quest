import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/reward-redemption-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function insertRedemptionRequest(
	input: { childId: ChildId; rewardId: string; requestedAt: number; quantity: number },
	tenantId: string,
) {
	return getRepos().rewardRedemption.insertRedemptionRequest(input, tenantId);
}

export async function findRedemptionRequestsByChild(childId: ChildId, tenantId: string) {
	return getRepos().rewardRedemption.findRedemptionRequestsByChild(childId, tenantId);
}

/**
 * #3329 backup restore 用: 申請時点の全フィールド (status / 解決情報 / snapshot) を保全して復元。
 * #4683: rewardId=null は「取込先に該当ごほうびが無い」を表し、履歴は snapshot で復元される。
 */
export async function insertRedemptionForRestore(
	input: {
		childId: ChildId;
		rewardId: string | null;
		requestedAt: number;
		quantity: number;
		status: string;
		parentNote: string | null;
		resolvedAt: number | null;
		resolvedByParentId: string | null;
		shownToChildAt: number | null;
		rewardTitle: string | null;
		rewardPoints: number | null;
		rewardIcon: string | null;
	},
	tenantId: string,
) {
	return getRepos().rewardRedemption.insertRedemptionForRestore(input, tenantId);
}

/** #4682 F1: id 直引き (一覧 limit 非依存)。承認 / 却下の存在確認はこちらを使う。 */
export async function findRedemptionRequestById(id: string, tenantId: string) {
	return getRepos().rewardRedemption.findRedemptionRequestById(id, tenantId);
}

export async function findRedemptionRequestsByTenant(
	tenantId: string,
	opts?: { status?: string; statuses?: readonly string[]; childId?: ChildId; limit?: number },
) {
	return getRepos().rewardRedemption.findRedemptionRequestsByTenant(tenantId, opts);
}

/** #3144: テナント内の交換申請の正確な件数 (COUNT、limit なし)。50 件以上でも飽和しない。 */
export async function countRedemptionRequestsByTenant(
	tenantId: string,
	opts?: { status?: string; statuses?: readonly string[]; childId?: ChildId },
) {
	return getRepos().rewardRedemption.countRedemptionRequestsByTenant(tenantId, opts);
}

/** #2845 課題①: childId 所有権検証付き (composite key)。不一致なら undefined。 */
export async function updateRedemptionRequestStatus(
	childId: ChildId,
	id: string,
	updates: {
		status: string;
		parentNote?: string | null;
		resolvedAt?: number | null;
		resolvedByParentId?: string | null;
	},
	tenantId: string,
) {
	return getRepos().rewardRedemption.updateRedemptionRequestStatus(childId, id, updates, tenantId);
}

// findPendingByChildAndReward は #3356 (1) で撤去。pending 重複判定は
// insertRedemptionRequest の repo 原子境界 dedup に内蔵済 (TOCTOU 根治)。

export async function expireOldRedemptions(tenantId: string) {
	return getRepos().rewardRedemption.expireOldRedemptions(tenantId);
}

export async function hasPendingByReward(rewardId: string, tenantId: string) {
	return getRepos().rewardRedemption.hasPendingByReward(rewardId, tenantId);
}
