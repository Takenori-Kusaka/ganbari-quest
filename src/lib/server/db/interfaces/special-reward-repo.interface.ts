import type { InsertSpecialRewardInput, SpecialReward } from '../types';

export interface ISpecialRewardRepo {
	insertSpecialReward(input: InsertSpecialRewardInput, tenantId: string): Promise<SpecialReward>;
	findSpecialRewards(childId: number, tenantId: string): Promise<SpecialReward[]>;
	findUnshownReward(childId: number, tenantId: string): Promise<SpecialReward | undefined>;
	markRewardShown(rewardId: number, tenantId: string): Promise<SpecialReward | undefined>;
}
