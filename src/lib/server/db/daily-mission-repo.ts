// src/lib/server/db/daily-mission-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function findTodayMissions(childId: number, date: string) {
	return getRepos().dailyMission.findTodayMissions(childId, date);
}
export async function findMissionBonusRecord(childId: number, description: string) {
	return getRepos().dailyMission.findMissionBonusRecord(childId, description);
}
export async function findMissionByActivity(childId: number, date: string, activityId: number) {
	return getRepos().dailyMission.findMissionByActivity(childId, date, activityId);
}
export async function markMissionCompleted(missionId: number) {
	return getRepos().dailyMission.markMissionCompleted(missionId);
}
export async function findAllMissionStatuses(childId: number, date: string) {
	return getRepos().dailyMission.findAllMissionStatuses(childId, date);
}
export async function findChildForMission(childId: number) {
	return getRepos().dailyMission.findChildForMission(childId);
}
export async function findVisibleActivities() {
	return getRepos().dailyMission.findVisibleActivities();
}
export async function findPreviousDayMissionIds(childId: number, date: string) {
	return getRepos().dailyMission.findPreviousDayMissionIds(childId, date);
}
export async function findRecentActivityIds(childId: number, sinceDate: string) {
	return getRepos().dailyMission.findRecentActivityIds(childId, sinceDate);
}
export async function findAllRecordedActivityIds(childId: number) {
	return getRepos().dailyMission.findAllRecordedActivityIds(childId);
}
export async function insertDailyMission(childId: number, date: string, activityId: number) {
	return getRepos().dailyMission.insertDailyMission(childId, date, activityId);
}
