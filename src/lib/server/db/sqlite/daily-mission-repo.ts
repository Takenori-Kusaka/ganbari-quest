// src/lib/server/db/daily-mission-repo.ts
// デイリーミッション関連のリポジトリ層

import { and, eq, gte } from 'drizzle-orm';
import { db } from '../client';
import { activities, activityLogs, children, dailyMissions, pointLedger } from '../schema';

/** 今日のミッション一覧を取得（活動情報JOIN） */
export async function findTodayMissions(childId: number, date: string, _tenantId: string) {
	return db
		.select({
			id: dailyMissions.id,
			activityId: dailyMissions.activityId,
			completed: dailyMissions.completed,
			activityName: activities.name,
			activityIcon: activities.icon,
			categoryId: activities.categoryId,
		})
		.from(dailyMissions)
		.innerJoin(activities, eq(dailyMissions.activityId, activities.id))
		.where(and(eq(dailyMissions.childId, childId), eq(dailyMissions.missionDate, date)))
		.all();
}

/** ミッションボーナス既付与レコードを取得 */
export async function findMissionBonusRecord(
	childId: number,
	description: string,
	_tenantId: string,
) {
	return db
		.select({ amount: pointLedger.amount })
		.from(pointLedger)
		.where(
			and(
				eq(pointLedger.childId, childId),
				eq(pointLedger.type, 'daily_mission'),
				eq(pointLedger.description, description),
			),
		)
		.get();
}

/** 特定活動のミッションを取得 */
export async function findMissionByActivity(
	childId: number,
	date: string,
	activityId: number,
	_tenantId: string,
) {
	return db
		.select({ id: dailyMissions.id, completed: dailyMissions.completed })
		.from(dailyMissions)
		.where(
			and(
				eq(dailyMissions.childId, childId),
				eq(dailyMissions.missionDate, date),
				eq(dailyMissions.activityId, activityId),
			),
		)
		.get();
}

/** ミッションを達成済みにする */
export async function markMissionCompleted(missionId: number, _tenantId: string) {
	db.update(dailyMissions)
		.set({ completed: 1, completedAt: new Date().toISOString() })
		.where(eq(dailyMissions.id, missionId))
		.run();
}

/** 今日の全ミッションの完了状態を取得 */
export async function findAllMissionStatuses(childId: number, date: string, _tenantId: string) {
	return db
		.select({ completed: dailyMissions.completed })
		.from(dailyMissions)
		.where(and(eq(dailyMissions.childId, childId), eq(dailyMissions.missionDate, date)))
		.all();
}

/** 子供情報を取得 */
export async function findChildForMission(childId: number, _tenantId: string) {
	return db.select().from(children).where(eq(children.id, childId)).get();
}

/** 表示可能な全活動を取得 */
export async function findVisibleActivities(_tenantId: string) {
	return db.select().from(activities).where(eq(activities.isVisible, 1)).all();
}

/** 前日のミッション活動IDを取得 */
export async function findPreviousDayMissionIds(childId: number, date: string, _tenantId: string) {
	return db
		.select({ activityId: dailyMissions.activityId })
		.from(dailyMissions)
		.where(and(eq(dailyMissions.childId, childId), eq(dailyMissions.missionDate, date)))
		.all()
		.map((m) => m.activityId);
}

/** 直近N日間の活動記録のactivityIdを取得 */
export async function findRecentActivityIds(childId: number, sinceDate: string, _tenantId: string) {
	return db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				gte(activityLogs.recordedDate, sinceDate),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all()
		.map((l) => l.activityId);
}

/** 全期間の活動記録のactivityIdを取得 */
export async function findAllRecordedActivityIds(childId: number, _tenantId: string) {
	return db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.all()
		.map((l) => l.activityId);
}

/** ミッションを挿入 */
export async function insertDailyMission(
	childId: number,
	date: string,
	activityId: number,
	_tenantId: string,
) {
	db.insert(dailyMissions).values({ childId, missionDate: date, activityId }).run();
}

/** テナントの全デイリーミッションを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(dailyMissions).run();
}
