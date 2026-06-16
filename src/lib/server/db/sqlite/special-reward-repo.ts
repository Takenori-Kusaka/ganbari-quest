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

/**
 * 特別報酬を表示済みにする。
 * #2845 課題① / B1: childId 所有権検証付き (composite key)。不一致なら更新せず undefined。
 */
export async function markRewardShown(childId: number, rewardId: number, _tenantId: string) {
	return db
		.update(specialRewards)
		.set({ shownAt: new Date().toISOString() })
		.where(and(eq(specialRewards.id, rewardId), eq(specialRewards.childId, childId)))
		.returning()
		.get();
}

/**
 * #2832: 特別報酬を編集 (title / points / icon / category)。
 * pending redemption が存在しても編集可 (案 b)。申請済みの交換は申請時点 snapshot
 * (reward_redemption_requests.reward_*) で処理されるため、本編集は申請に波及しない。
 */
export async function updateSpecialReward(
	childId: number,
	rewardId: number,
	updates: UpdateSpecialRewardInput,
	_tenantId: string,
) {
	// #2845 課題①: childId 所有権検証付き (composite key)
	const ownership = and(eq(specialRewards.id, rewardId), eq(specialRewards.childId, childId));
	const set: Partial<typeof specialRewards.$inferInsert> = {};
	if (updates.title !== undefined) set.title = updates.title;
	if (updates.points !== undefined) set.points = updates.points;
	if (updates.icon !== undefined) set.icon = updates.icon;
	if (updates.category !== undefined) set.category = updates.category;
	if (Object.keys(set).length === 0) {
		return db.select().from(specialRewards).where(ownership).get();
	}
	return db.update(specialRewards).set(set).where(ownership).returning().get();
}

/**
 * #2832: 特別報酬を削除。
 * pending redemption ガードは service 層 (hasPendingByReward) が担う前提。
 * FK (reward_redemption_requests.reward_id → special_rewards.id) 整合のため、
 * 解決済 (approved/rejected/expired) の交換申請履歴行も同一トランザクションで削除する。
 */
export async function deleteSpecialReward(
	childId: number,
	rewardId: number,
	_tenantId: string,
): Promise<boolean> {
	// #2845 課題①: childId 所有権検証付き (composite key)。reward は per-child のため
	// 交換申請履歴の cascade 削除も同 child scope に閉じる。
	return db.transaction((tx) => {
		tx.delete(rewardRedemptionRequests)
			.where(
				and(
					eq(rewardRedemptionRequests.rewardId, rewardId),
					eq(rewardRedemptionRequests.childId, childId),
				),
			)
			.run();
		const result = tx
			.delete(specialRewards)
			.where(and(eq(specialRewards.id, rewardId), eq(specialRewards.childId, childId)))
			.run();
		return result.changes > 0;
	});
}

/** テナントの全特別報酬を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(specialRewards).run();
}
