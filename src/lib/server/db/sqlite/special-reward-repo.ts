import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import type { UpdateSpecialRewardInput } from '../interfaces/special-reward-repo.interface';
import { rewardRedemptionRequests, specialRewards } from '../schema';
import type { InsertSpecialRewardInput, SpecialReward } from '../types';

type RewardRow = typeof specialRewards.$inferSelect;

const toReward = (r: RewardRow): SpecialReward => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	grantedBy: r.grantedBy === null ? null : String(r.grantedBy),
});

/** 特別報酬を記録 */
export async function insertSpecialReward(
	input: InsertSpecialRewardInput,
	_tenantId: string,
): Promise<SpecialReward> {
	return toReward(
		db
			.insert(specialRewards)
			.values({
				...input,
				childId: Number(input.childId),
				grantedBy: input.grantedBy == null ? null : Number(input.grantedBy),
			})
			.returning()
			.get(),
	);
}

/** 子供の特別報酬履歴を取得（降順） */
export async function findSpecialRewards(
	childId: ChildId,
	_tenantId: string,
): Promise<SpecialReward[]> {
	return db
		.select()
		.from(specialRewards)
		.where(eq(specialRewards.childId, Number(childId)))
		.orderBy(desc(specialRewards.grantedAt))
		.all()
		.map(toReward);
}

/** 子供の未表示の特別報酬を1件取得 */
export async function findUnshownReward(
	childId: ChildId,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	const row = db
		.select()
		.from(specialRewards)
		.where(and(eq(specialRewards.childId, Number(childId)), isNull(specialRewards.shownAt)))
		.orderBy(desc(specialRewards.grantedAt))
		.limit(1)
		.get();
	return row ? toReward(row) : undefined;
}

/**
 * 特別報酬を表示済みにする。
 * #2845 課題① / B1: childId 所有権検証付き (composite key)。不一致なら更新せず undefined。
 *
 * #4435 (逸脱 2、条件 SSOT: parallel-implementations.md §13 条件 1): `shown_at IS NULL` guard で
 * 冪等にし、再送で初回表示時刻を上書きしない。0 行になった場合は所有権を満たす行を読み直して
 * 返す (「既に既読」と「他人の子の行」を呼び出し側の 404 判定が区別できるようにするため)。
 */
export async function markRewardShown(
	childId: ChildId,
	rewardId: string,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	const owned = and(
		eq(specialRewards.id, Number(rewardId)),
		eq(specialRewards.childId, Number(childId)),
	);
	const row = db
		.update(specialRewards)
		.set({ shownAt: new Date().toISOString() })
		.where(and(owned, isNull(specialRewards.shownAt)))
		.returning()
		.get();
	if (row) return toReward(row);
	const already = db.select().from(specialRewards).where(owned).get();
	return already ? toReward(already) : undefined;
}

/**
 * #2832: 特別報酬を編集 (title / points / icon / category)。
 * pending redemption が存在しても編集可 (案 b)。申請済みの交換は申請時点 snapshot
 * (reward_redemption_requests.reward_*) で処理されるため、本編集は申請に波及しない。
 */
export async function updateSpecialReward(
	childId: ChildId,
	rewardId: string,
	updates: UpdateSpecialRewardInput,
	_tenantId: string,
): Promise<SpecialReward | undefined> {
	// #2845 課題①: childId 所有権検証付き (composite key)
	const ownership = and(
		eq(specialRewards.id, Number(rewardId)),
		eq(specialRewards.childId, Number(childId)),
	);
	const set: Partial<typeof specialRewards.$inferInsert> = {};
	if (updates.title !== undefined) set.title = updates.title;
	if (updates.points !== undefined) set.points = updates.points;
	if (updates.icon !== undefined) set.icon = updates.icon;
	if (updates.category !== undefined) set.category = updates.category;
	// #3154: 陳列系統 (physical/money/privilege/null) を編集で変更可能にする
	if (updates.shopCategory !== undefined) set.shopCategory = updates.shopCategory;
	if (Object.keys(set).length === 0) {
		const row = db.select().from(specialRewards).where(ownership).get();
		return row ? toReward(row) : undefined;
	}
	const row = db.update(specialRewards).set(set).where(ownership).returning().get();
	return row ? toReward(row) : undefined;
}

/**
 * #2832 / #4683: 特別報酬を削除。
 * pending redemption ガードは service 層 (hasPendingByReward) が担う前提。
 *
 * #4683: **交換申請履歴は削除しない**。point_ledger の控除は残るため、履歴だけ消すと
 * 子供からは「ポイントが勝手に減った」、親からは「何に使ったか辿れない」状態になる。
 * 代わりに、snapshot 列が未設定の旧行 (#2832 より前に作られた行) を削除前に live reward の
 * 値で backfill し、reward が消えても表示が空にならないようにする。
 * FK は #4683 で外してあるため、reward 削除後も履歴行は残り続ける (schema.ts 参照)。
 */
export async function deleteSpecialReward(
	childId: ChildId,
	rewardId: string,
	_tenantId: string,
): Promise<boolean> {
	// #2845 課題①: childId 所有権検証付き (composite key)。reward は per-child のため
	// snapshot backfill も同 child scope に閉じる。
	return db.transaction((tx) => {
		const rid = Number(rewardId);
		tx.update(rewardRedemptionRequests)
			.set({
				rewardTitle: sql`COALESCE(${rewardRedemptionRequests.rewardTitle}, (SELECT ${specialRewards.title} FROM ${specialRewards} WHERE ${specialRewards.id} = ${rid}))`,
				rewardPoints: sql`COALESCE(${rewardRedemptionRequests.rewardPoints}, (SELECT ${specialRewards.points} FROM ${specialRewards} WHERE ${specialRewards.id} = ${rid}))`,
				rewardIcon: sql`COALESCE(${rewardRedemptionRequests.rewardIcon}, (SELECT ${specialRewards.icon} FROM ${specialRewards} WHERE ${specialRewards.id} = ${rid}))`,
			})
			.where(
				and(
					eq(rewardRedemptionRequests.rewardId, Number(rewardId)),
					eq(rewardRedemptionRequests.childId, Number(childId)),
				),
			)
			.run();
		const result = tx
			.delete(specialRewards)
			.where(
				and(eq(specialRewards.id, Number(rewardId)), eq(specialRewards.childId, Number(childId))),
			)
			.run();
		return result.changes > 0;
	});
}

/** テナントの全特別報酬を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(specialRewards).run();
}
