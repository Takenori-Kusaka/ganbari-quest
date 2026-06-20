import type { InsertSpecialRewardInput, SpecialReward } from '../types';

/** #2832 / #3154: reward 編集 input (title / points / icon / category / shopCategory を編集可) */
export interface UpdateSpecialRewardInput {
	title?: string;
	points?: number;
	icon?: string | null;
	category?: string;
	// #3154: ショップ陳列系統 (physical/money/privilege/null)。undefined = 既存値保全。
	shopCategory?: string | null;
}

export interface ISpecialRewardRepo {
	insertSpecialReward(input: InsertSpecialRewardInput, tenantId: string): Promise<SpecialReward>;
	findSpecialRewards(childId: number, tenantId: string): Promise<SpecialReward[]>;
	findUnshownReward(childId: number, tenantId: string): Promise<SpecialReward | undefined>;
	/**
	 * #2845 課題① / B1: childId + rewardId の複合キーで child partition を直接参照する
	 * (id-only mutation 禁止、cross-tenant / cross-child 到達の構造的遮断)。
	 * 不一致なら undefined。
	 */
	markRewardShown(
		childId: number,
		rewardId: number,
		tenantId: string,
	): Promise<SpecialReward | undefined>;
	/**
	 * #2832: reward 編集。pending redemption が存在しても編集可 (案 b)。
	 * 申請済みの交換は申請時点 snapshot (reward_redemption_requests.reward_*) で処理される。
	 * #2845 課題①: childId 所有権検証付き。
	 */
	updateSpecialReward(
		childId: number,
		rewardId: number,
		updates: UpdateSpecialRewardInput,
		tenantId: string,
	): Promise<SpecialReward | undefined>;
	/**
	 * #2832: reward 削除。pending redemption ガードは service 層 (hasPendingByReward) が担う。
	 * 解決済 (approved/rejected/expired) の交換申請履歴行も同時に削除する (FK 整合)。
	 * #2845 課題①: childId 所有権検証付き。
	 */
	deleteSpecialReward(childId: number, rewardId: number, tenantId: string): Promise<boolean>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
