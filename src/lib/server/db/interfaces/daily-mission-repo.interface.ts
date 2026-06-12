import type { Activity, Child, ChildActivity, DailyMissionWithActivity } from '../types';

export interface IDailyMissionRepo {
	findTodayMissions(
		childId: number,
		date: string,
		tenantId: string,
	): Promise<DailyMissionWithActivity[]>;
	findMissionBonusRecord(
		childId: number,
		description: string,
		tenantId: string,
	): Promise<{ amount: number } | undefined>;
	findMissionByActivity(
		childId: number,
		date: string,
		activityId: number,
		tenantId: string,
	): Promise<{ id: number; completed: number } | undefined>;
	/**
	 * #2845 B1: (childId, date, activityId) 複合キー必須 (旧 missionId-only は DynamoDB 側で
	 * tenant 無束縛 Scan + 全 tenant write 可能形状)。DynamoDB は exact Key (`dailyMissionKey`)
	 * で直接 UpdateItem、SQLite は composite WHERE。不在 / 不一致は silent no-op。
	 */
	markMissionCompleted(
		childId: number,
		date: string,
		activityId: number,
		tenantId: string,
	): Promise<void>;
	findAllMissionStatuses(
		childId: number,
		date: string,
		tenantId: string,
	): Promise<{ completed: number }[]>;
	findChildForMission(childId: number, tenantId: string): Promise<Child | undefined>;
	// #2362 PR-3 Phase 7b-2c: sqlite は ChildActivity (per-child instance) を返す。
	// dynamodb / demo 実装は legacy Activity を返す (PR-3 scope 外、#2458 で 統一)。
	findVisibleActivities(tenantId: string): Promise<Array<Activity | ChildActivity>>;
	findPreviousDayMissionIds(childId: number, date: string, tenantId: string): Promise<number[]>;
	findRecentActivityIds(childId: number, sinceDate: string, tenantId: string): Promise<number[]>;
	findAllRecordedActivityIds(childId: number, tenantId: string): Promise<number[]>;
	insertDailyMission(
		childId: number,
		date: string,
		activityId: number,
		tenantId: string,
	): Promise<void>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
