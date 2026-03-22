// src/lib/server/db/activity-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	ActivityFilter,
	InsertActivityInput,
	InsertActivityLogInput,
	InsertPointLedgerInput,
	UpdateActivityInput,
} from './types';

export type { ActivityFilter };

// Activities
export async function findActivities(filter?: ActivityFilter) {
	return getRepos().activity.findActivities(filter);
}
export async function findActivityById(id: number) {
	return getRepos().activity.findActivityById(id);
}
export async function insertActivity(input: InsertActivityInput) {
	return getRepos().activity.insertActivity(input);
}
export async function updateActivity(id: number, input: UpdateActivityInput) {
	return getRepos().activity.updateActivity(id, input);
}
export async function setActivityVisibility(id: number, visible: boolean) {
	return getRepos().activity.setActivityVisibility(id, visible);
}
export async function deleteActivity(id: number) {
	return getRepos().activity.deleteActivity(id);
}
export async function hasActivityLogs(activityId: number) {
	return getRepos().activity.hasActivityLogs(activityId);
}
export async function getActivityLogCounts() {
	return getRepos().activity.getActivityLogCounts();
}
export async function deleteDailyMissionsByActivity(activityId: number) {
	return getRepos().activity.deleteDailyMissionsByActivity(activityId);
}

// Children
export async function findChildById(id: number) {
	return getRepos().activity.findChildById(id);
}

// Activity Logs
export async function findDailyLog(childId: number, activityId: number, date: string) {
	return getRepos().activity.findDailyLog(childId, activityId, date);
}
export async function findStreakLogs(childId: number, activityId: number) {
	return getRepos().activity.findStreakLogs(childId, activityId);
}
export async function insertActivityLog(input: InsertActivityLogInput) {
	return getRepos().activity.insertActivityLog(input);
}
export async function findActivityLogById(id: number) {
	return getRepos().activity.findActivityLogById(id);
}
export async function markActivityLogCancelled(id: number) {
	return getRepos().activity.markActivityLogCancelled(id);
}
export async function findActivityLogs(childId: number, options?: { from?: string; to?: string }) {
	return getRepos().activity.findActivityLogs(childId, options);
}
export async function countTodayActiveRecords(childId: number, activityId: number, date: string) {
	return getRepos().activity.countTodayActiveRecords(childId, activityId, date);
}
export async function getTodayActivityCountsByChild(childId: number, date: string) {
	return getRepos().activity.getTodayActivityCountsByChild(childId, date);
}
export async function findTodayRecordedActivityIds(childId: number, today: string) {
	return getRepos().activity.findTodayRecordedActivityIds(childId, today);
}

// Aggregation
export async function findDistinctRecordedDates(childId: number) {
	return getRepos().activity.findDistinctRecordedDates(childId);
}
export async function countActiveActivityLogs(childId: number) {
	return getRepos().activity.countActiveActivityLogs(childId);
}
export async function getCategoryCountsByDate(childId: number) {
	return getRepos().activity.getCategoryCountsByDate(childId);
}
export async function countDistinctCategories(childId: number) {
	return getRepos().activity.countDistinctCategories(childId);
}
export async function findTodayLogsWithCategory(childId: number, date: string) {
	return getRepos().activity.findTodayLogsWithCategory(childId, date);
}
export async function getComboPointsGranted(childId: number, descriptionPrefix: string) {
	return getRepos().activity.getComboPointsGranted(childId, descriptionPrefix);
}

// Point Ledger
export async function insertPointLedger(input: InsertPointLedgerInput) {
	return getRepos().activity.insertPointLedger(input);
}
