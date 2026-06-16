// Demo ISpecialRewardRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { getDemoMarketplaceSpecialRewardsByChild } from '$lib/server/demo/demo-data';
import type { UpdateSpecialRewardInput } from '../interfaces/special-reward-repo.interface';
import type { InsertSpecialRewardInput, SpecialReward } from '../types';

export async function insertSpecialReward(
	input: InsertSpecialRewardInput,
	_tenantId: string,
): Promise<SpecialReward> {
	return {
		id: 0,
		childId: input.childId,
		grantedBy: input.grantedBy ?? null,
		title: input.title,
		description: input.description ?? null,
		points: input.points,
		icon: input.icon ?? null,
		category: input.category,
		grantedAt: new Date().toISOString(),
		shownAt: null,
		sourcePresetId: input.sourcePresetId ?? null,
	};
}

export async function findSpecialRewards(
	childId: number,
	_tenantId: string,
): Promise<SpecialReward[]> {
	// #2097 Phase B-7: marketplace reward-set 由来の pre-granted rewards を返す
	return getDemoMarketplaceSpecialRewardsByChild(childId);
}

export async function findUnshownReward(
	childId: number,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	// #2097 Phase B-5a: marketplace 由来 rewards のうち shownAt=null の最初の 1 件を返す
	// (子供ホームで SpecialRewardOverlay = おうかん演出 / 達成プレゼント modal を発火させる)
	const rewards = getDemoMarketplaceSpecialRewardsByChild(childId);
	return rewards.find((r) => r.shownAt === null);
}

export async function markRewardShown(
	_childId: number,
	_rewardId: number,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	// Stateless: fixture を mutate せず success として undefined (sqlite repo の returning().get()
	// と整合: 該当行が無いと undefined)。demo 用途では子供ホーム再 reload 時に同じ unshown
	// reward が再度 modal 表示されても UX 上問題なし (anti-engagement 原則 ADR-0012: 子供が
	// modal を閉じる動作で十分体験は完結する)
	return undefined;
}

/**
 * #2832: 編集 stub。Stateless demo は fixture を mutate しない (write = no-op)。
 * sqlite repo の「該当行なし → undefined」と整合させ undefined を返す
 * (UI 側は demo フラグで no-op を明示するため成功偽装しない)。
 */
export async function updateSpecialReward(
	_childId: number,
	_rewardId: number,
	_updates: UpdateSpecialRewardInput,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	return undefined;
}

/**
 * #2832: 削除 stub。Stateless demo は fixture を mutate しない (write = no-op)。
 * sqlite repo の「該当行なし → false」と整合させ false を返す。
 */
export async function deleteSpecialReward(
	_childId: number,
	_rewardId: number,
	_tenantId: string,
): Promise<boolean> {
	return false;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
