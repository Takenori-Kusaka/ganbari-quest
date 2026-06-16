// src/lib/server/db/sqlite/reward-redemption-repo.ts
// ごほうびショップ交換申請リポジトリ (#1337)

import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { children, rewardRedemptionRequests, specialRewards } from '../schema';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

// #2832: 申請時点 snapshot fallback。
// 新規行は insert 時に reward_* snapshot を保存し、編集後も「申請時点の内容 (名前/ポイント)」で
// 表示・控除する (DynamoDB 非正規化 item と等価の仕様)。snapshot 列導入前の旧行 (NULL) は
// live JOIN 値に fallback する。
const snapshotTitle = sql<string>`COALESCE(${rewardRedemptionRequests.rewardTitle}, ${specialRewards.title})`;
const snapshotIcon = sql<
	string | null
>`COALESCE(${rewardRedemptionRequests.rewardIcon}, ${specialRewards.icon})`;
const snapshotPoints = sql<number>`COALESCE(${rewardRedemptionRequests.rewardPoints}, ${specialRewards.points})`;

/** 交換申請を作成（#2832: reward title/points/icon の申請時点 snapshot を保存） */
export async function insertRedemptionRequest(
	input: {
		childId: number;
		rewardId: number;
		requestedAt: number;
	},
	_tenantId: string,
) {
	const reward = db
		.select({
			title: specialRewards.title,
			points: specialRewards.points,
			icon: specialRewards.icon,
		})
		.from(specialRewards)
		.where(eq(specialRewards.id, input.rewardId))
		.get();

	return db
		.insert(rewardRedemptionRequests)
		.values({
			childId: input.childId,
			rewardId: input.rewardId,
			requestedAt: input.requestedAt,
			status: 'pending_parent_approval',
			rewardTitle: reward?.title ?? null,
			rewardPoints: reward?.points ?? null,
			rewardIcon: reward?.icon ?? null,
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

/** 親がご家族の見守り画面で見る申請一覧（子供名・報酬名を含む） */
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
			// #2832: 申請時点 snapshot 優先 (旧行は live JOIN 値に fallback)
			rewardTitle: snapshotTitle,
			rewardIcon: snapshotIcon,
			rewardPoints: snapshotPoints,
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

/**
 * 申請状態を更新。
 * #2845 課題①: childId 所有権検証付き (composite key)。不一致なら更新せず undefined。
 */
export async function updateRedemptionRequestStatus(
	childId: number,
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
		.where(and(eq(rewardRedemptionRequests.id, id), eq(rewardRedemptionRequests.childId, childId)))
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
			// #2832: 申請時点 snapshot 優先 (旧行は live JOIN 値に fallback)
			rewardTitle: snapshotTitle,
			rewardIcon: snapshotIcon,
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

/**
 * 未表示通知を表示済みにする。
 * #2845 課題①: childId 所有権検証付き (composite key)。不一致なら更新せず undefined。
 */
export async function markRedemptionResultShown(childId: number, id: number, _tenantId: string) {
	const now = Math.floor(Date.now() / 1000);
	return db
		.update(rewardRedemptionRequests)
		.set({ shownToChildAt: now })
		.where(and(eq(rewardRedemptionRequests.id, id), eq(rewardRedemptionRequests.childId, childId)))
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
