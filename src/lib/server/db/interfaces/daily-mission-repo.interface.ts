import type { ActivityId, ChildId } from '$lib/domain/ids';
import type { Activity, Child, ChildActivity, DailyMissionWithActivity } from '../types';

export interface IDailyMissionRepo {
	findTodayMissions(
		childId: ChildId,
		date: string,
		tenantId: string,
	): Promise<DailyMissionWithActivity[]>;
	findMissionBonusRecord(
		childId: ChildId,
		description: string,
		tenantId: string,
	): Promise<{ amount: number } | undefined>;
	findMissionByActivity(
		childId: ChildId,
		date: string,
		activityId: ActivityId,
		tenantId: string,
	): Promise<{ id: string; completed: number } | undefined>;
	/**
	 * #2845 B1: (childId, date, activityId) 複合キー必須 (旧 missionId-only は DynamoDB 側で
	 * tenant 無束縛 Scan + 全 tenant write 可能形状)。DynamoDB は exact Key (`dailyMissionKey`)
	 * で直接 UpdateItem、SQLite は composite WHERE。不在 / 不一致は silent no-op。
	 */
	markMissionCompleted(
		childId: ChildId,
		date: string,
		activityId: ActivityId,
		tenantId: string,
	): Promise<void>;
	/**
	 * #4686: とりけし時の対称巻き戻し。(childId, date, activityId) 複合キーで completed=1 → 0 に戻す
	 * (不在 / 未達成は silent no-op)。呼び出し側 (service) が「同 activity の当日 active log が 0 件」を
	 * 確認してから呼ぶ (dailyLimit>1 の活動で 1 件だけ取消した場合は達成のまま)。
	 */
	markMissionUncompleted(
		childId: ChildId,
		date: string,
		activityId: ActivityId,
		tenantId: string,
	): Promise<void>;
	findAllMissionStatuses(
		childId: ChildId,
		date: string,
		tenantId: string,
	): Promise<{ completed: number }[]>;
	findChildForMission(childId: ChildId, tenantId: string): Promise<Child | undefined>;
	// #2362 PR-3 Phase 7b-2c: sqlite は ChildActivity (per-child instance) を返す。
	// dynamodb / demo 実装は legacy Activity を返す (PR-3 scope 外、#2458 で 統一)。
	findVisibleActivities(tenantId: string): Promise<Array<Activity | ChildActivity>>;
	findPreviousDayMissionIds(
		childId: ChildId,
		date: string,
		tenantId: string,
	): Promise<ActivityId[]>;
	findRecentActivityIds(
		childId: ChildId,
		sinceDate: string,
		tenantId: string,
	): Promise<ActivityId[]>;
	findAllRecordedActivityIds(childId: ChildId, tenantId: string): Promise<ActivityId[]>;
	insertDailyMission(
		childId: ChildId,
		date: string,
		activityId: ActivityId,
		tenantId: string,
	): Promise<void>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}
