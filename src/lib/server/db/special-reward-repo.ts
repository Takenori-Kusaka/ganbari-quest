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
/** #2845 課題① / B1: childId 所有権検証付き (composite key)。不一致なら undefined。 */
export async function markRewardShown(childId: number, rewardId: number, tenantId: string) {
	return getRepos().specialReward.markRewardShown(childId, rewardId, tenantId);
}
/** #2832: reward 編集 (pending redemption 中も編集可、snapshot は申請時点値)。#2845: childId 検証付き */
export async function updateSpecialReward(
	childId: number,
	rewardId: number,
	updates: UpdateSpecialRewardInput,
	tenantId: string,
) {
	return getRepos().specialReward.updateSpecialReward(childId, rewardId, updates, tenantId);
}
/** #2832: reward 削除 (pending ガードは service 層 hasPendingByReward が担う)。#2845: childId 検証付き */
export async function deleteSpecialReward(childId: number, rewardId: number, tenantId: string) {
	return getRepos().specialReward.deleteSpecialReward(childId, rewardId, tenantId);
}
