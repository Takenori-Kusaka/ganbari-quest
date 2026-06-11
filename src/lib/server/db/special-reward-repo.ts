// src/lib/server/db/special-reward-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { UpdateSpecialRewardInput } from './interfaces/special-reward-repo.interface';
import type { InsertSpecialRewardInput } from './types';

export async function insertSpecialReward(input: InsertSpecialRewardInput, tenantId: string) {
	return getRepos().specialReward.insertSpecialReward(input, tenantId);
}
export async function findSpecialRewards(childId: number, tenantId: string) {
	return getRepos().specialReward.findSpecialRewards(childId, tenantId);
}
export async function findUnshownReward(childId: number, tenantId: string) {
	return getRepos().specialReward.findUnshownReward(childId, tenantId);
}
export async function markRewardShown(rewardId: number, tenantId: string) {
	return getRepos().specialReward.markRewardShown(rewardId, tenantId);
}
/** #2832: reward 編集 (pending redemption 中も編集可、snapshot は申請時点値) */
export async function updateSpecialReward(
	rewardId: number,
	updates: UpdateSpecialRewardInput,
	tenantId: string,
) {
	return getRepos().specialReward.updateSpecialReward(rewardId, updates, tenantId);
}
/** #2832: reward 削除 (pending ガードは service 層 hasPendingByReward が担う) */
export async function deleteSpecialReward(rewardId: number, tenantId: string) {
	return getRepos().specialReward.deleteSpecialReward(rewardId, tenantId);
}
