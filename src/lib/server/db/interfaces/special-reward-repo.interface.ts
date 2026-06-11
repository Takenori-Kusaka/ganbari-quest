import type { InsertSpecialRewardInput, SpecialReward } from '../types';

/** #2832: reward 編集 input (title / points / icon / category のみ編集可) */
export interface UpdateSpecialRewardInput {
	title?: string;
	points?: number;
	icon?: string | null;
	category?: string;
}

export interface ISpecialRewardRepo {
	insertSpecialReward(input: InsertSpecialRewardInput, tenantId: string): Promise<SpecialReward>;
	findSpecialRewards(childId: number, tenantId: string): Promise<SpecialReward[]>;
	findUnshownReward(childId: number, tenantId: string): Promise<SpecialReward | undefined>;
	markRewardShown(rewardId: number, tenantId: string): Promise<SpecialReward | undefined>;
	/**
	 * #2832: reward 編集。pending redemption が存在しても編集可 (案 b)。
	 * 申請済みの交換は申請時点 snapshot (reward_redemption_requests.reward_*) で処理される。
	 */
	updateSpecialReward(
		rewardId: number,
		updates: UpdateSpecialRewardInput,
		tenantId: string,
	): Promise<SpecialReward | undefined>;
	/**
	 * #2832: reward 削除。pending redemption ガードは service 層 (hasPendingByReward) が担う。
	 * 解決済 (approved/rejected/expired) の交換申請履歴行も同時に削除する (FK 整合)。
	 */
	deleteSpecialReward(rewardId: number, tenantId: string): Promise<boolean>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
