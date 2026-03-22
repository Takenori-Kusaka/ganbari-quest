// src/lib/server/db/special-reward-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertSpecialRewardInput } from './types';

export async function insertSpecialReward(input: InsertSpecialRewardInput) {
	return getRepos().specialReward.insertSpecialReward(input);
}
export async function findSpecialRewards(childId: number) {
	return getRepos().specialReward.findSpecialRewards(childId);
}
export async function findUnshownReward(childId: number) {
	return getRepos().specialReward.findUnshownReward(childId);
}
export async function markRewardShown(rewardId: number) {
	return getRepos().specialReward.markRewardShown(rewardId);
}
