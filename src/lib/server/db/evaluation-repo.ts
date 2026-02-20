// src/lib/server/db/evaluation-repo.ts
// 週次評価関連のリポジトリ層

import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { db } from './client';
import { activityLogs, activities, evaluations, children } from './schema';

/** 指定期間のカテゴリ別活動回数を集計 */
export function countActivitiesByCategory(
	childId: number,
	weekStart: string,
	weekEnd: string,
) {
	return db
		.select({
			category: activities.category,
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
		.groupBy(activities.category)
		.all();
}

/** 評価結果を保存 */
export function insertEvaluation(input: {
	childId: number;
	weekStart: string;
	weekEnd: string;
	scoresJson: string;
	bonusPoints: number;
}) {
	return db.insert(evaluations).values(input).returning().get();
}

/** 全子供を取得 */
export function findAllChildren() {
	return db.select().from(children).all();
}

/** 子供の最終活動日をカテゴリ別に取得 */
export function findLastActivityDateByCategory(childId: number) {
	return db
		.select({
			category: activities.category,
			lastDate: sql<string>`max(${activityLogs.recordedDate})`,
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(
			and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)),
		)
		.groupBy(activities.category)
		.all();
}
