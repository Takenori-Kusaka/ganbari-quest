// src/lib/server/db/special-reward-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
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
