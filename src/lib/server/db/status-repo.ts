// src/lib/server/db/status-repo.ts
// ステータス関連のリポジトリ層

import { eq, and, desc, max } from 'drizzle-orm';
import { db } from './client';
import {
	statuses,
	statusHistory,
	marketBenchmarks,
	children,
	activityLogs,
} from './schema';
import type { Category } from '$lib/domain/validation/activity';

/** 子供の全ステータスを取得 */
export function findStatuses(childId: number) {
	return db
		.select()
		.from(statuses)
		.where(eq(statuses.childId, childId))
		.all();
}

/** カテゴリ別のステータスを取得 */
export function findStatus(childId: number, category: string) {
	return db
		.select()
		.from(statuses)
		.where(and(eq(statuses.childId, childId), eq(statuses.category, category)))
		.get();
}

/** ステータスを更新（upsert） */
export function upsertStatus(
	childId: number,
	category: string,
	value: number,
) {
	const existing = findStatus(childId, category);
	const clampedValue = Math.max(0, Math.min(100, value));
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
		.values({ childId, category, value: clampedValue, updatedAt: now })
		.returning()
		.get();
}

/** ステータス変動履歴を追加 */
export function insertStatusHistory(input: {
	childId: number;
	category: string;
	value: number;
	changeAmount: number;
	changeType: string;
}) {
	return db.insert(statusHistory).values(input).returning().get();
}

/** 直近のステータス変動を取得 */
export function findRecentStatusHistory(
	childId: number,
	category: string,
	limit: number = 7,
) {
	return db
		.select()
		.from(statusHistory)
		.where(
			and(
				eq(statusHistory.childId, childId),
				eq(statusHistory.category, category),
			),
		)
		.orderBy(desc(statusHistory.recordedAt))
		.limit(limit)
		.all();
}

/** 市場ベンチマークを取得 */
export function findBenchmark(age: number, category: string) {
	return db
		.select()
		.from(marketBenchmarks)
		.where(
			and(
				eq(marketBenchmarks.age, age),
				eq(marketBenchmarks.category, category),
			),
		)
		.get();
}

/** 子供の存在確認（年齢も取得） */
export function findChildById(id: number) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

/** カテゴリ別の最終活動日を取得 */
export function findLastActivityDates(childId: number) {
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
