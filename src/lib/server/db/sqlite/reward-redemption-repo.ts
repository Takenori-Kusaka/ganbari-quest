// src/lib/server/db/sqlite/reward-redemption-repo.ts
// ごほうびショップ交換申請リポジトリ (#1337)

import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '../client';
import { children, rewardRedemptionRequests, specialRewards } from '../schema';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

/** 交換申請を作成 */
export async function insertRedemptionRequest(
	input: {
		childId: number;
		rewardId: number;
		requestedAt: number;
	},
	_tenantId: string,
) {
	return db
		.insert(rewardRedemptionRequests)
		.values({
			childId: input.childId,
			rewardId: input.rewardId,
			requestedAt: input.requestedAt,
			status: 'pending_parent_approval',
		})
		.returning()
		.get();
}

/** 子供の交換申請一覧を取得（最新順） */
export async function findRedemptionRequestsByChild(childId: number, _tenantId: string) {
	return db
		.select()
		.from(rewardRedemptionRequests)
		.where(eq(rewardRedemptionRequests.childId, childId))
		.orderBy(desc(rewardRedemptionRequests.requestedAt))
		.all();
}

/** 親が管理画面で見る申請一覧（子供名・報酬名を含む） */
export async function findRedemptionRequestsByTenant(
	_tenantId: string,
	opts?: { status?: string; childId?: number; limit?: number },
) {
	const conditions = [];
	if (opts?.status) {
		conditions.push(eq(rewardRedemptionRequests.status, opts.status));
	}
	if (opts?.childId) {
		conditions.push(eq(rewardRedemptionRequests.childId, opts.childId));
	}

	const rows = await db
		.select({
			id: rewardRedemptionRequests.id,
			childId: rewardRedemptionRequests.childId,
			rewardId: rewardRedemptionRequests.rewardId,
			requestedAt: rewardRedemptionRequests.requestedAt,
			status: rewardRedemptionRequests.status,
			parentNote: rewardRedemptionRequests.parentNote,
			resolvedAt: rewardRedemptionRequests.resolvedAt,
			resolvedByParentId: rewardRedemptionRequests.resolvedByParentId,
			shownToChildAt: rewardRedemptionRequests.shownToChildAt,
			childName: children.nickname,
			rewardTitle: specialRewards.title,
			rewardIcon: specialRewards.icon,
			rewardPoints: specialRewards.points,
		})
		.from(rewardRedemptionRequests)
		.innerJoin(children, eq(rewardRedemptionRequests.childId, children.id))
		.innerJoin(specialRewards, eq(rewardRedemptionRequests.rewardId, specialRewards.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(rewardRedemptionRequests.requestedAt))
		.limit(opts?.limit ?? 50)
		.all();

	return rows;
}

/** 申請状態を更新 */
export async function updateRedemptionRequestStatus(
	id: number,
	updates: {
		status: string;
		parentNote?: string | null;
		resolvedAt?: number | null;
		resolvedByParentId?: number | null;
	},
	_tenantId: string,
) {
	return db
		.update(rewardRedemptionRequests)
		.set(updates)
		.where(eq(rewardRedemptionRequests.id, id))
		.returning()
		.get();
}

/** 子供の特定報酬に対して pending 申請が存在するか確認 */
export async function findPendingByChildAndReward(
	childId: number,
	rewardId: number,
	_tenantId: string,
) {
	return db
		.select()
		.from(rewardRedemptionRequests)
		.where(
			and(
				eq(rewardRedemptionRequests.childId, childId),
				eq(rewardRedemptionRequests.rewardId, rewardId),
				eq(rewardRedemptionRequests.status, 'pending_parent_approval'),
			),
		)
		.limit(1)
		.get();
}

/** 子供の未表示の承認/却下通知を取得 */
export async function findUnshownResultByChild(childId: number, _tenantId: string) {
	return db
		.select({
			id: rewardRedemptionRequests.id,
			childId: rewardRedemptionRequests.childId,
			rewardId: rewardRedemptionRequests.rewardId,
			requestedAt: rewardRedemptionRequests.requestedAt,
			status: rewardRedemptionRequests.status,
			parentNote: rewardRedemptionRequests.parentNote,
			resolvedAt: rewardRedemptionRequests.resolvedAt,
			resolvedByParentId: rewardRedemptionRequests.resolvedByParentId,
			shownToChildAt: rewardRedemptionRequests.shownToChildAt,
			rewardTitle: specialRewards.title,
			rewardIcon: specialRewards.icon,
		})
		.from(rewardRedemptionRequests)
		.innerJoin(specialRewards, eq(rewardRedemptionRequests.rewardId, specialRewards.id))
		.where(
			and(
				eq(rewardRedemptionRequests.childId, childId),
				inArray(rewardRedemptionRequests.status, ['approved', 'rejected']),
				isNull(rewardRedemptionRequests.shownToChildAt),
			),
		)
		.orderBy(desc(rewardRedemptionRequests.resolvedAt))
		.limit(1)
		.get();
}

/** 未表示通知を表示済みにする */
export async function markRedemptionResultShown(id: number, _tenantId: string) {
	const now = Math.floor(Date.now() / 1000);
	return db
		.update(rewardRedemptionRequests)
		.set({ shownToChildAt: now })
		.where(eq(rewardRedemptionRequests.id, id))
		.returning()
		.get();
}

/** 30日以上 pending の申請を expired に移行 */
export async function expireOldRedemptions(_tenantId: string) {
	const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SECONDS;
	const result = db
		.update(rewardRedemptionRequests)
		.set({ status: 'expired' })
		.where(
			and(
				eq(rewardRedemptionRequests.status, 'pending_parent_approval'),
				lt(rewardRedemptionRequests.requestedAt, cutoff),
			),
		)
		.returning()
		.all();
	return result.length;
}

/** 特定の reward_id に pending 申請が存在するか確認（削除前チェック用） */
export async function hasPendingByReward(rewardId: number, _tenantId: string) {
	const row = db
		.select({ id: rewardRedemptionRequests.id })
		.from(rewardRedemptionRequests)
		.where(
			and(
				eq(rewardRedemptionRequests.rewardId, rewardId),
				eq(rewardRedemptionRequests.status, 'pending_parent_approval'),
			),
		)
		.limit(1)
		.get();
	return !!row;
}

/** テナントの全申請を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(rewardRedemptionRequests).run();
}
