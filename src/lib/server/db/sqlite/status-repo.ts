// src/lib/server/db/status-repo.ts
// ステータス関連のリポジトリ層

import { and, desc, eq, max } from 'drizzle-orm';
import { db } from '../client';
import { activityLogs, children, marketBenchmarks, statusHistory, statuses } from '../schema';

/** 子供の全ステータスを取得 */
export async function findStatuses(childId: number, _tenantId: string) {
	return db.select().from(statuses).where(eq(statuses.childId, childId)).all();
}

/** カテゴリ別のステータスを取得 */
export async function findStatus(childId: number, categoryId: number, _tenantId: string) {
	return db
		.select()
		.from(statuses)
		.where(and(eq(statuses.childId, childId), eq(statuses.categoryId, categoryId)))
		.get();
}

/** ステータスを更新（upsert） */
export async function upsertStatus(
	childId: number,
	categoryId: number,
	value: number,
	_tenantId: string,
) {
	const existing = await findStatus(childId, categoryId, _tenantId);
	const clampedValue = Math.max(0, value);
	const now = new Date().toISOString();

	if (existing) {
		return db
			.update(statuses)
			.set({ value: clampedValue, updatedAt: now })
			.where(eq(statuses.id, existing.id))
			.returning()
			.get();
	}

	return db
		.insert(statuses)
		.values({ childId, categoryId, value: clampedValue, updatedAt: now })
		.returning()
		.get();
}

/** ステータス変動履歴を追加 */
export async function insertStatusHistory(
	input: {
		childId: number;
		categoryId: number;
		value: number;
		changeAmount: number;
		changeType: string;
	},
	_tenantId: string,
) {
	return db.insert(statusHistory).values(input).returning().get();
}

/** 直近のステータス変動を取得 */
export async function findRecentStatusHistory(
	childId: number,
	categoryId: number,
	_tenantId: string,
	limit = 7,
) {
	return db
		.select()
		.from(statusHistory)
		.where(and(eq(statusHistory.childId, childId), eq(statusHistory.categoryId, categoryId)))
		.orderBy(desc(statusHistory.recordedAt))
		.limit(limit)
		.all();
}

/** 市場ベンチマークを取得 */
export async function findBenchmark(age: number, categoryId: number, _tenantId: string) {
	return db
		.select()
		.from(marketBenchmarks)
		.where(and(eq(marketBenchmarks.age, age), eq(marketBenchmarks.categoryId, categoryId)))
		.get();
}

/** 全ベンチマークを取得（年齢・カテゴリ順） */
export async function findAllBenchmarks(_tenantId: string) {
	return db
		.select()
		.from(marketBenchmarks)
		.orderBy(marketBenchmarks.age, marketBenchmarks.categoryId)
		.all();
}

/** ベンチマークをupsert */
export async function upsertBenchmark(
	age: number,
	categoryId: number,
	mean: number,
	stdDev: number,
	source: string,
	_tenantId: string,
) {
	const existing = await findBenchmark(age, categoryId, _tenantId);
	const now = new Date().toISOString();
	if (existing) {
		return db
			.update(marketBenchmarks)
			.set({ mean, stdDev, source, updatedAt: now })
			.where(eq(marketBenchmarks.id, existing.id))
			.returning()
			.get();
	}
	return db
		.insert(marketBenchmarks)
		.values({ age, categoryId, mean, stdDev, source })
		.returning()
		.get();
}

/** 子供の存在確認（年齢も取得） */
export async function findChildById(id: number, _tenantId: string) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

/** カテゴリ別の最終活動日を取得 */
export async function findLastActivityDates(childId: number, _tenantId: string) {
	return db
		.select({
			category: activityLogs.activityId,
			lastDate: max(activityLogs.recordedDate),
		})
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.activityId)
		.all();
}
