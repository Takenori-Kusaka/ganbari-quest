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
export async function findActivities(tenantId: string, filter?: ActivityFilter) {
	return getRepos().activity.findActivities(tenantId, filter);
}
export async function findActivityById(id: number, tenantId: string) {
	return getRepos().activity.findActivityById(id, tenantId);
}
export async function insertActivity(input: InsertActivityInput, tenantId: string) {
	return getRepos().activity.insertActivity(input, tenantId);
}
export async function updateActivity(id: number, input: UpdateActivityInput, tenantId: string) {
	return getRepos().activity.updateActivity(id, input, tenantId);
}
export async function setActivityVisibility(id: number, visible: boolean, tenantId: string) {
	return getRepos().activity.setActivityVisibility(id, visible, tenantId);
}
export async function deleteActivity(id: number, tenantId: string) {
	return getRepos().activity.deleteActivity(id, tenantId);
}
export async function hasActivityLogs(activityId: number, tenantId: string) {
	return getRepos().activity.hasActivityLogs(activityId, tenantId);
}
export async function getActivityLogCounts(tenantId: string) {
	return getRepos().activity.getActivityLogCounts(tenantId);
}
export async function countMainQuestActivities(tenantId: string) {
	return getRepos().activity.countMainQuestActivities(tenantId);
}

export async function deleteDailyMissionsByActivity(activityId: number, tenantId: string) {
	return getRepos().activity.deleteDailyMissionsByActivity(activityId, tenantId);
}

// Children
export async function findChildById(id: number, tenantId: string) {
	return getRepos().activity.findChildById(id, tenantId);
}

// Activity Logs
async function _findDailyLog(childId: number, activityId: number, date: string, tenantId: string) {
	return getRepos().activity.findDailyLog(childId, activityId, date, tenantId);
}
export async function findStreakLogs(childId: number, activityId: number, tenantId: string) {
	return getRepos().activity.findStreakLogs(childId, activityId, tenantId);
}
export async function insertActivityLog(input: InsertActivityLogInput, tenantId: string) {
	return getRepos().activity.insertActivityLog(input, tenantId);
}
export async function findActivityLogById(id: number, tenantId: string) {
	return getRepos().activity.findActivityLogById(id, tenantId);
}
export async function markActivityLogCancelled(id: number, tenantId: string) {
	return getRepos().activity.markActivityLogCancelled(id, tenantId);
}
export async function findActivityLogs(
	childId: number,
	tenantId: string,
	options?: { from?: string; to?: string },
) {
	return getRepos().activity.findActivityLogs(childId, tenantId, options);
}
export async function countTodayActiveRecords(
	childId: number,
	activityId: number,
	date: string,
	tenantId: string,
) {
	return getRepos().activity.countTodayActiveRecords(childId, activityId, date, tenantId);
}
export async function getTodayActivityCountsByChild(
	childId: number,
	date: string,
	tenantId: string,
) {
	return getRepos().activity.getTodayActivityCountsByChild(childId, date, tenantId);
}
async function _findTodayRecordedActivityIds(childId: number, today: string, tenantId: string) {
	return getRepos().activity.findTodayRecordedActivityIds(childId, today, tenantId);
}

// Aggregation
export async function findDistinctRecordedDates(childId: number, tenantId: string) {
	return getRepos().activity.findDistinctRecordedDates(childId, tenantId);
}
export async function countActiveActivityLogs(childId: number, tenantId: string) {
	return getRepos().activity.countActiveActivityLogs(childId, tenantId);
}
async function _getCategoryCountsByDate(childId: number, tenantId: string) {
	return getRepos().activity.getCategoryCountsByDate(childId, tenantId);
}
async function _countDistinctCategories(childId: number, tenantId: string) {
	return getRepos().activity.countDistinctCategories(childId, tenantId);
}
export async function findTodayLogsWithCategory(childId: number, date: string, tenantId: string) {
	return getRepos().activity.findTodayLogsWithCategory(childId, date, tenantId);
}
export async function getComboPointsGranted(
	childId: number,
	descriptionPrefix: string,
	tenantId: string,
) {
	return getRepos().activity.getComboPointsGranted(childId, descriptionPrefix, tenantId);
}
async function _countActiveActivityLogsByCategory(
	childId: number,
	categoryId: number,
	tenantId: string,
) {
	return getRepos().activity.countActiveActivityLogsByCategory(childId, categoryId, tenantId);
}
async function _countPointLedgerEntriesByType(childId: number, type: string, tenantId: string) {
	return getRepos().activity.countPointLedgerEntriesByType(childId, type, tenantId);
}

export async function countPointLedgerEntriesByTypeAndDate(
	childId: number,
	type: string,
	date: string,
	tenantId: string,
) {
	return getRepos().activity.countPointLedgerEntriesByTypeAndDate(childId, type, date, tenantId);
}

// #783: archive / restore
export async function archiveActivities(ids: number[], reason: string, tenantId: string) {
	return getRepos().activity.archiveActivities(ids, reason, tenantId);
}
export async function restoreArchivedActivities(reason: string, tenantId: string) {
	return getRepos().activity.restoreArchivedActivities(reason, tenantId);
}

// Point Ledger
export async function insertPointLedger(input: InsertPointLedgerInput, tenantId: string) {
	return getRepos().activity.insertPointLedger(input, tenantId);
}
