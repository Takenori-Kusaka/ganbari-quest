import type { ChildId } from '$lib/domain/ids';
// Demo IRewardRedemptionRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	RedemptionRequestRow,
	RedemptionRequestWithDetails,
} from '../interfaces/reward-redemption-repo.interface';

export async function insertRedemptionRequest(
	input: { childId: ChildId; rewardId: string; requestedAt: number; quantity: number },
	_tenantId: string,
): Promise<RedemptionRequestRow> {
	return {
		id: '0',
		childId: input.childId,
		rewardId: input.rewardId,
		requestedAt: input.requestedAt,
		// #4407: 個数は入力をそのまま反映する (Fake read が「1 個に潰れた」ように見えないように)
		quantity: input.quantity,
		status: 'pending',
		parentNote: null,
		resolvedAt: null,
		resolvedByParentId: null,
		shownToChildAt: null,
	};
}

export async function insertRedemptionForRestore(
	_input: {
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
	_tenantId: string,
): Promise<RedemptionRequestRow | null> {
	// Stub: demo は書き込み no-op。#3394: 永続化していないため null を返し
	// import カウント (rewardRedemptionsImported) を偽装しない (#2263 count 偽装 class)。
	return null;
}

export async function findRedemptionRequestsByChild(
	_childId: ChildId,
	_tenantId: string,
): Promise<RedemptionRequestRow[]> {
	return [];
}

export async function findRedemptionRequestsByTenant(
	_tenantId: string,
	_opts?: { status?: string; childId?: ChildId; limit?: number },
): Promise<RedemptionRequestWithDetails[]> {
	return [];
}

export async function countRedemptionRequestsByTenant(
	_tenantId: string,
	_opts?: { status?: string; childId?: ChildId },
): Promise<number> {
	return 0;
}

export async function updateRedemptionRequestStatus(
	_childId: ChildId,
	_id: string,
	_updates: {
		status: string;
		parentNote?: string | null;
		resolvedAt?: number | null;
		resolvedByParentId?: string | null;
	},
	_tenantId: string,
): Promise<RedemptionRequestRow | undefined> {
	return undefined;
}

// findPendingByChildAndReward は #3356 (1) で撤去 (dedup は insertRedemptionRequest に内蔵。
// demo は stateless stub のため dedup せず常に stub row を返す = 従来挙動不変)。

// #4435: findUnshownResultByChild / markRedemptionResultShown は撤去 (到達不能経路)。
// 交換申請の承認・却下は子供のごほうびショップのバッジと履歴画面が常時表示しており、
// `shown_to_child_at` を使う一度きりの通知は production から呼ばれていなかった (#4432 実測)。
// 列はバックアップ往復のため保持する (終了条件は schema.ts の定義コメント)。

export async function expireOldRedemptions(_tenantId: string): Promise<number> {
	return 0;
}

export async function hasPendingByReward(_rewardId: string, _tenantId: string): Promise<boolean> {
	return false;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
