import type { ActivityId, ChildId } from '$lib/domain/ids';
// src/lib/server/db/daily-mission-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function findTodayMissions(childId: ChildId, date: string, tenantId: string) {
	return getRepos().dailyMission.findTodayMissions(childId, date, tenantId);
}
export async function findMissionBonusRecord(
	childId: ChildId,
	description: string,
	tenantId: string,
) {
	return getRepos().dailyMission.findMissionBonusRecord(childId, description, tenantId);
}
export async function findMissionByActivity(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	tenantId: string,
) {
	return getRepos().dailyMission.findMissionByActivity(childId, date, activityId, tenantId);
}
// #2845 B1: (childId, date, activityId) 所有権検証付き (composite key)
export async function markMissionCompleted(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	tenantId: string,
) {
	return getRepos().dailyMission.markMissionCompleted(childId, date, activityId, tenantId);
}
// #4686: とりけし時の対称巻き戻し (completed 1 → 0)
export async function markMissionUncompleted(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	tenantId: string,
) {
	return getRepos().dailyMission.markMissionUncompleted(childId, date, activityId, tenantId);
}
export async function findAllMissionStatuses(childId: ChildId, date: string, tenantId: string) {
	return getRepos().dailyMission.findAllMissionStatuses(childId, date, tenantId);
}
export async function findChildForMission(childId: ChildId, tenantId: string) {
	return getRepos().dailyMission.findChildForMission(childId, tenantId);
}
export async function findVisibleActivities(tenantId: string) {
	return getRepos().dailyMission.findVisibleActivities(tenantId);
}
export async function findPreviousDayMissionIds(childId: ChildId, date: string, tenantId: string) {
	return getRepos().dailyMission.findPreviousDayMissionIds(childId, date, tenantId);
}
export async function findRecentActivityIds(childId: ChildId, sinceDate: string, tenantId: string) {
	return getRepos().dailyMission.findRecentActivityIds(childId, sinceDate, tenantId);
}
export async function findAllRecordedActivityIds(childId: ChildId, tenantId: string) {
	return getRepos().dailyMission.findAllRecordedActivityIds(childId, tenantId);
}
export async function insertDailyMission(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	tenantId: string,
) {
	return getRepos().dailyMission.insertDailyMission(childId, date, activityId, tenantId);
}
