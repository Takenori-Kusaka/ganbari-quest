import type { InsertSpecialRewardInput, SpecialReward } from '../types';

export interface ISpecialRewardRepo {
	insertSpecialReward(input: InsertSpecialRewardInput): Promise<SpecialReward>;
	findSpecialRewards(childId: number): Promise<SpecialReward[]>;
	findUnshownReward(childId: number): Promise<SpecialReward | undefined>;
	markRewardShown(rewardId: number): Promise<SpecialReward | undefined>;
}
