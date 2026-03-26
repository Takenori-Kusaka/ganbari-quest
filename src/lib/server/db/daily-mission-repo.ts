// src/lib/server/db/daily-mission-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function findTodayMissions(childId: number, date: string, tenantId: string) {
	return getRepos().dailyMission.findTodayMissions(childId, date, tenantId);
}
export async function findMissionBonusRecord(
	childId: number,
	description: string,
	tenantId: string,
) {
	return getRepos().dailyMission.findMissionBonusRecord(childId, description, tenantId);
}
export async function findMissionByActivity(
	childId: number,
	date: string,
	activityId: number,
	tenantId: string,
) {
	return getRepos().dailyMission.findMissionByActivity(childId, date, activityId, tenantId);
}
export async function markMissionCompleted(missionId: number, tenantId: string) {
	return getRepos().dailyMission.markMissionCompleted(missionId, tenantId);
}
export async function findAllMissionStatuses(childId: number, date: string, tenantId: string) {
	return getRepos().dailyMission.findAllMissionStatuses(childId, date, tenantId);
}
export async function findChildForMission(childId: number, tenantId: string) {
	return getRepos().dailyMission.findChildForMission(childId, tenantId);
}
export async function findVisibleActivities(tenantId: string) {
	return getRepos().dailyMission.findVisibleActivities(tenantId);
}
export async function findPreviousDayMissionIds(childId: number, date: string, tenantId: string) {
	return getRepos().dailyMission.findPreviousDayMissionIds(childId, date, tenantId);
}
export async function findRecentActivityIds(childId: number, sinceDate: string, tenantId: string) {
	return getRepos().dailyMission.findRecentActivityIds(childId, sinceDate, tenantId);
}
export async function findAllRecordedActivityIds(childId: number, tenantId: string) {
	return getRepos().dailyMission.findAllRecordedActivityIds(childId, tenantId);
}
export async function insertDailyMission(
	childId: number,
	date: string,
	activityId: number,
	tenantId: string,
) {
	return getRepos().dailyMission.insertDailyMission(childId, date, activityId, tenantId);
}
