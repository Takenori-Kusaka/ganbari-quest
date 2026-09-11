// src/lib/server/db/daily-mission-repo.ts
// デイリーミッション関連のリポジトリ層

import { and, eq, gte } from 'drizzle-orm';
import {
	type ActivityId,
	asActivityId,
	asCategoryId,
	asChildId,
	type ChildId,
} from '$lib/domain/ids';
import { db } from '../client';
import { activityLogs, childActivities, children, dailyMissions, pointLedger } from '../schema';
import type { Child, ChildActivity, DailyMissionWithActivity } from '../types';

/** 今日のミッション一覧を取得（活動情報JOIN） */
export async function findTodayMissions(
	childId: ChildId,
	date: string,
	_tenantId: string,
): Promise<DailyMissionWithActivity[]> {
	// #2362 PR-3 Phase 7b-2c: schema FK は child_activities に切替済 (Phase 7b-2a)。
	// daily_missions.activity_id → child_activities.id を JOIN。
	return db
		.select({
			id: dailyMissions.id,
			activityId: dailyMissions.activityId,
			completed: dailyMissions.completed,
			activityName: childActivities.name,
			activityIcon: childActivities.icon,
			categoryId: childActivities.categoryId,
		})
		.from(dailyMissions)
		.innerJoin(childActivities, eq(dailyMissions.activityId, childActivities.id))
		.where(and(eq(dailyMissions.childId, Number(childId)), eq(dailyMissions.missionDate, date)))
		.all()
		.map((r) => ({
			...r,
			id: String(r.id),
			activityId: asActivityId(r.activityId),
			categoryId: asCategoryId(r.categoryId),
		}));
}

/** ミッションボーナス既付与レコードを取得 */
export async function findMissionBonusRecord(
	childId: ChildId,
	description: string,
	_tenantId: string,
) {
	return db
		.select({ amount: pointLedger.amount })
		.from(pointLedger)
		.where(
			and(
				eq(pointLedger.childId, Number(childId)),
				eq(pointLedger.type, 'daily_mission'),
				eq(pointLedger.description, description),
			),
		)
		.get();
}

/** 特定活動のミッションを取得 */
export async function findMissionByActivity(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	_tenantId: string,
): Promise<{ id: string; completed: number } | undefined> {
	const row = db
		.select({ id: dailyMissions.id, completed: dailyMissions.completed })
		.from(dailyMissions)
		.where(
			and(
				eq(dailyMissions.childId, Number(childId)),
				eq(dailyMissions.missionDate, date),
				eq(dailyMissions.activityId, Number(activityId)),
			),
		)
		.get();
	return row ? { ...row, id: String(row.id) } : undefined;
}

/**
 * ミッションを達成済みにする。
 * #2845 B1: (childId, date, activityId) 所有権検証付き (composite key)。
 * 不一致なら affected 0 の no-op (DynamoDB exact Key + attribute_exists と等価)。
 */
export async function markMissionCompleted(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	_tenantId: string,
) {
	db.update(dailyMissions)
		.set({ completed: 1, completedAt: new Date().toISOString() })
		.where(
			and(
				eq(dailyMissions.childId, Number(childId)),
				eq(dailyMissions.missionDate, date),
				eq(dailyMissions.activityId, Number(activityId)),
			),
		)
		.run();
}

/**
 * #4686: とりけし時の対称巻き戻し (completed 1 → 0)。複合キー完全一致、不在は no-op。
 */
export async function markMissionUncompleted(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	_tenantId: string,
) {
	db.update(dailyMissions)
		.set({ completed: 0, completedAt: null })
		.where(
			and(
				eq(dailyMissions.childId, Number(childId)),
				eq(dailyMissions.missionDate, date),
				eq(dailyMissions.activityId, Number(activityId)),
			),
		)
		.run();
}

/** 今日の全ミッションの完了状態を取得 */
export async function findAllMissionStatuses(childId: ChildId, date: string, _tenantId: string) {
	return db
		.select({ completed: dailyMissions.completed })
		.from(dailyMissions)
		.where(and(eq(dailyMissions.childId, Number(childId)), eq(dailyMissions.missionDate, date)))
		.all();
}

/** 子供情報を取得 */
export async function findChildForMission(
	childId: ChildId,
	_tenantId: string,
): Promise<Child | undefined> {
	const row = db
		.select()
		.from(children)
		.where(eq(children.id, Number(childId)))
		.get();
	return row ? { ...row, id: asChildId(row.id) } : undefined;
}

/**
 * 表示可能な全活動を取得
 * #2362 PR-3 Phase 7b-2c: signature 不変のまま、内部実装を child_activities (全件、全 child 横断)
 * に切替。daily-mission の callsite (`generateMissions(childId)`) は child filter を service 側で
 * 適用する。注意: 戻り値は ChildActivity 形状 (ageMin/ageMax 等の旧 fields は無い)。
 */
export async function findVisibleActivities(_tenantId: string): Promise<ChildActivity[]> {
	return db
		.select()
		.from(childActivities)
		.where(eq(childActivities.isVisible, 1))
		.all()
		.map((r) => ({
			...r,
			id: asActivityId(r.id),
			childId: asChildId(r.childId),
			categoryId: asCategoryId(r.categoryId),
		}));
}

/** 前日のミッション活動IDを取得 */
export async function findPreviousDayMissionIds(
	childId: ChildId,
	date: string,
	_tenantId: string,
): Promise<ActivityId[]> {
	return db
		.select({ activityId: dailyMissions.activityId })
		.from(dailyMissions)
		.where(and(eq(dailyMissions.childId, Number(childId)), eq(dailyMissions.missionDate, date)))
		.all()
		.map((m) => asActivityId(m.activityId));
}

/** 直近N日間の活動記録のactivityIdを取得 */
export async function findRecentActivityIds(
	childId: ChildId,
	sinceDate: string,
	_tenantId: string,
): Promise<ActivityId[]> {
	return db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, Number(childId)),
				gte(activityLogs.recordedDate, sinceDate),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all()
		.map((l) => asActivityId(l.activityId));
}

/** 全期間の活動記録のactivityIdを取得 */
export async function findAllRecordedActivityIds(
	childId: ChildId,
	_tenantId: string,
): Promise<ActivityId[]> {
	return db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, Number(childId)), eq(activityLogs.cancelled, 0)))
		.all()
		.map((l) => asActivityId(l.activityId));
}

/** ミッションを挿入
 *
 * #2565: `getTodayMissions` は TOCTOU (check `findTodayMissions().length === 0` →
 * generate → insert) のため、同一 child home に並行リクエストが到達すると両方が
 * `generateMissions` を実行し、同じ `(child_id, mission_date, activity_id)` で重複
 * INSERT → `idx_daily_missions_unique` violation で 500 を返す (E2E workers=2 で
 * 同一 worker DB を共有する child-tutorial spec が複数 child home に並行アクセスして
 * flake 化した root cause)。`onConflictDoNothing` で重複 INSERT を静かに skip し、
 * 並行 generate でも constraint violation を起こさず同一 mission set に収束させる。
 * ADR-0006 整合 (テスト側 retry でなく実装側 race の真因解消)。 */
export async function insertDailyMission(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	_tenantId: string,
) {
	db.insert(dailyMissions)
		.values({ childId: Number(childId), missionDate: date, activityId: Number(activityId) })
		.onConflictDoNothing({
			target: [dailyMissions.childId, dailyMissions.missionDate, dailyMissions.activityId],
		})
		.run();
}

/** テナントの全デイリーミッションを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(dailyMissions).run();
}
