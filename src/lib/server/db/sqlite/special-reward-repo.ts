import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../client';
import type { UpdateSpecialRewardInput } from '../interfaces/special-reward-repo.interface';
import { rewardRedemptionRequests, specialRewards } from '../schema';

/** 特別報酬を記録 */
export async function insertSpecialReward(
	input: {
		childId: number;
		grantedBy?: number | null;
		title: string;
		description?: string;
		points: number;
		icon?: string;
		category: string;
		sourcePresetId?: string | null;
	},
	_tenantId: string,
) {
	return db.insert(specialRewards).values(input).returning().get();
}

/** 子供の特別報酬履歴を取得（降順） */
export async function findSpecialRewards(childId: number, _tenantId: string) {
	return db
		.select()
		.from(specialRewards)
		.where(eq(specialRewards.childId, childId))
		.orderBy(desc(specialRewards.grantedAt))
		.all();
}

/** 子供の未表示の特別報酬を1件取得 */
export async function findUnshownReward(childId: number, _tenantId: string) {
	return db
		.select()
		.from(specialRewards)
		.where(and(eq(specialRewards.childId, childId), isNull(specialRewards.shownAt)))
		.orderBy(desc(specialRewards.grantedAt))
		.limit(1)
		.get();
}

/** 特別報酬を表示済みにする */
export async function markRewardShown(rewardId: number, _tenantId: string) {
	return db
		.update(specialRewards)
		.set({ shownAt: new Date().toISOString() })
		.where(eq(specialRewards.id, rewardId))
		.returning()
		.get();
}

/**
 * #2832: 特別報酬を編集 (title / points / icon / category)。
 * pending redemption が存在しても編集可 (案 b)。申請済みの交換は申請時点 snapshot
 * (reward_redemption_requests.reward_*) で処理されるため、本編集は申請に波及しない。
 */
export async function updateSpecialReward(
	rewardId: number,
	updates: UpdateSpecialRewardInput,
	_tenantId: string,
) {
	const set: Partial<typeof specialRewards.$inferInsert> = {};
	if (updates.title !== undefined) set.title = updates.title;
	if (updates.points !== undefined) set.points = updates.points;
	if (updates.icon !== undefined) set.icon = updates.icon;
	if (updates.category !== undefined) set.category = updates.category;
	if (Object.keys(set).length === 0) {
		return db.select().from(specialRewards).where(eq(specialRewards.id, rewardId)).get();
	}
	return db
		.update(specialRewards)
		.set(set)
		.where(eq(specialRewards.id, rewardId))
		.returning()
		.get();
}

/**
 * #2832: 特別報酬を削除。
 * pending redemption ガードは service 層 (hasPendingByReward) が担う前提。
 * FK (reward_redemption_requests.reward_id → special_rewards.id) 整合のため、
 * 解決済 (approved/rejected/expired) の交換申請履歴行も同一トランザクションで削除する。
 */
export async function deleteSpecialReward(rewardId: number, _tenantId: string): Promise<boolean> {
	return db.transaction((tx) => {
		tx.delete(rewardRedemptionRequests)
			.where(eq(rewardRedemptionRequests.rewardId, rewardId))
			.run();
		const result = tx.delete(specialRewards).where(eq(specialRewards.id, rewardId)).run();
		return result.changes > 0;
	});
}

/** テナントの全特別報酬を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(specialRewards).run();
}
