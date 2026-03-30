// src/lib/server/db/evaluation-repo.ts
// 週次評価関連のリポジトリ層

import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import { db } from '../client';
import {
	activities,
	activityLogs,
	children,
	evaluations,
	restDays,
	statusHistory,
} from '../schema';

/** 指定期間のカテゴリ別活動回数を集計 */
export async function countActivitiesByCategory(
	childId: number,
	weekStart: string,
	weekEnd: string,
	_tenantId: string,
) {
	return db
		.select({
			categoryId: activities.categoryId,
			count: sql<number>`count(*)`,
			totalPoints: sql<number>`sum(${activityLogs.points})`,
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.cancelled, 0),
				gte(activityLogs.recordedDate, weekStart),
				lte(activityLogs.recordedDate, weekEnd),
			),
		)
		.groupBy(activities.categoryId)
		.all();
}

/** 評価結果を保存 */
export async function insertEvaluation(
	input: {
		childId: number;
		weekStart: string;
		weekEnd: string;
		scoresJson: string;
		bonusPoints: number;
	},
	_tenantId: string,
) {
	return db.insert(evaluations).values(input).returning().get();
}

/** 全子供を取得 */
export async function findAllChildren(_tenantId: string) {
	return db.select().from(children).all();
}

/** 子供の評価履歴を取得 */
export async function findEvaluationsByChild(childId: number, limit: number, _tenantId: string) {
	return db
		.select()
		.from(evaluations)
		.where(eq(evaluations.childId, childId))
		.orderBy(desc(evaluations.createdAt))
		.limit(limit)
		.all();
}

/** 指定日にdaily_decayが既に実行されたか確認 */
export async function hasDecayRunToday(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<boolean> {
	const row = db
		.select({ id: statusHistory.id })
		.from(statusHistory)
		.where(
			and(
				eq(statusHistory.childId, childId),
				eq(statusHistory.changeType, 'daily_decay'),
				like(statusHistory.recordedAt, `${today}%`),
			),
		)
		.get();
	return !!row;
}

/** 指定週の評価が存在するか確認 */
export async function findWeekEvaluation(childId: number, weekStart: string, _tenantId: string) {
	return db
		.select({ id: evaluations.id })
		.from(evaluations)
		.where(and(eq(evaluations.childId, childId), eq(evaluations.weekStart, weekStart)))
		.get();
}

/** 子供の最終活動日をカテゴリ別に取得 */
export async function findLastActivityDateByCategory(childId: number, _tenantId: string) {
	return db
		.select({
			categoryId: activities.categoryId,
			lastDate: sql<string>`max(${activityLogs.recordedDate})`,
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activities.categoryId)
		.all();
}

// ============================================================
// おやすみ日 (rest_days)
// ============================================================

/** おやすみ日を登録 */
export async function insertRestDay(
	childId: number,
	date: string,
	reason: string,
	_tenantId: string,
) {
	return db
		.insert(restDays)
		.values({ childId, date, reason })
		.onConflictDoNothing()
		.returning()
		.get();
}

/** おやすみ日を削除 */
export async function deleteRestDay(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<void> {
	db.delete(restDays)
		.where(and(eq(restDays.childId, childId), eq(restDays.date, date)))
		.run();
}

/** 指定日がおやすみかどうか */
export async function isRestDay(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<boolean> {
	const row = db
		.select({ id: restDays.id })
		.from(restDays)
		.where(and(eq(restDays.childId, childId), eq(restDays.date, date)))
		.get();
	return !!row;
}

/** 子供の今月のおやすみ日数を取得 */
export async function countRestDaysInMonth(
	childId: number,
	yearMonth: string,
	_tenantId: string,
): Promise<number> {
	const rows = db
		.select({ id: restDays.id })
		.from(restDays)
		.where(and(eq(restDays.childId, childId), like(restDays.date, `${yearMonth}%`)))
		.all();
	return rows.length;
}

/** 子供のおやすみ日一覧を取得 */
export async function findRestDays(childId: number, yearMonth: string, _tenantId: string) {
	return db
		.select()
		.from(restDays)
		.where(and(eq(restDays.childId, childId), like(restDays.date, `${yearMonth}%`)))
		.orderBy(restDays.date)
		.all();
}
