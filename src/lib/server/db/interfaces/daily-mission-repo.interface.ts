import type { Activity, Child, DailyMissionWithActivity } from '../types';

export interface IDailyMissionRepo {
	findTodayMissions(childId: number, date: string): Promise<DailyMissionWithActivity[]>;
	findMissionBonusRecord(
		childId: number,
		description: string,
	): Promise<{ amount: number } | undefined>;
	findMissionByActivity(
		childId: number,
		date: string,
		activityId: number,
	): Promise<{ id: number; completed: number } | undefined>;
	markMissionCompleted(missionId: number): Promise<void>;
	findAllMissionStatuses(childId: number, date: string): Promise<{ completed: number }[]>;
	findChildForMission(childId: number): Promise<Child | undefined>;
	findVisibleActivities(): Promise<Activity[]>;
	findPreviousDayMissionIds(childId: number, date: string): Promise<number[]>;
	findRecentActivityIds(childId: number, sinceDate: string): Promise<number[]>;
	findAllRecordedActivityIds(childId: number): Promise<number[]>;
	insertDailyMission(childId: number, date: string, activityId: number): Promise<void>;
}
