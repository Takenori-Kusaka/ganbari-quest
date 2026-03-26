import type { Activity, Child, DailyMissionWithActivity } from '../types';

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
	markMissionCompleted(missionId: number, tenantId: string): Promise<void>;
	findAllMissionStatuses(
		childId: number,
		date: string,
		tenantId: string,
	): Promise<{ completed: number }[]>;
	findChildForMission(childId: number, tenantId: string): Promise<Child | undefined>;
	findVisibleActivities(tenantId: string): Promise<Activity[]>;
	findPreviousDayMissionIds(childId: number, date: string, tenantId: string): Promise<number[]>;
	findRecentActivityIds(childId: number, sinceDate: string, tenantId: string): Promise<number[]>;
	findAllRecordedActivityIds(childId: number, tenantId: string): Promise<number[]>;
	insertDailyMission(
		childId: number,
		date: string,
		activityId: number,
		tenantId: string,
	): Promise<void>;
}
