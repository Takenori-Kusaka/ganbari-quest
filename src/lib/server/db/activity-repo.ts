import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
// src/lib/server/db/activity-repo.ts — Facade (delegates to factory)

import type { ArchivedReason } from '$lib/domain/archive-types';
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
export async function findActivityById(id: ActivityId, tenantId: string) {
	return getRepos().activity.findActivityById(id, tenantId);
}
/**
 * activity を id + child + tenant の 3 軸でスコープ取得する (CWE-598 / ADR-0055 §3.1 cross-child guard)。
 *
 * `findActivityById(id, tenantId)` は tenant スコープのみで child を見ないため、
 * child A の context で child B の `child_activities.id` を渡すと素通りしてしまう
 * (#2520 で確認した IDOR 盲点)。記録 (recordActivity) のように childId が確定している
 * write path では本関数を使い、`childActivities.child_id != childId` の越境を構造的に防ぐ。
 */
export async function findActivityByIdForChild(id: ActivityId, childId: ChildId, tenantId: string) {
	return getRepos().childActivity.findActivityById(id, childId, tenantId);
}
export async function insertActivity(input: InsertActivityInput, tenantId: string) {
	return getRepos().activity.insertActivity(input, tenantId);
}
export async function updateActivity(id: ActivityId, input: UpdateActivityInput, tenantId: string) {
	return getRepos().activity.updateActivity(id, input, tenantId);
}
export async function setActivityVisibility(id: ActivityId, visible: boolean, tenantId: string) {
	return getRepos().activity.setActivityVisibility(id, visible, tenantId);
}
export async function deleteActivity(id: ActivityId, tenantId: string) {
	return getRepos().activity.deleteActivity(id, tenantId);
}
export async function hasActivityLogs(activityId: ActivityId, tenantId: string) {
	return getRepos().activity.hasActivityLogs(activityId, tenantId);
}
export async function getActivityLogCounts(tenantId: string) {
	return getRepos().activity.getActivityLogCounts(tenantId);
}
export async function countMainQuestActivities(tenantId: string) {
	return getRepos().activity.countMainQuestActivities(tenantId);
}

export async function deleteDailyMissionsByActivity(activityId: ActivityId, tenantId: string) {
	return getRepos().activity.deleteDailyMissionsByActivity(activityId, tenantId);
}

// Children
export async function findChildById(id: ChildId, tenantId: string) {
	return getRepos().activity.findChildById(id, tenantId);
}

// Activity Logs
async function _findDailyLog(
	childId: ChildId,
	activityId: ActivityId,
	date: string,
	tenantId: string,
) {
	return getRepos().activity.findDailyLog(childId, activityId, date, tenantId);
}
export async function findStreakLogs(childId: ChildId, activityId: ActivityId, tenantId: string) {
	return getRepos().activity.findStreakLogs(childId, activityId, tenantId);
}
export async function insertActivityLog(input: InsertActivityLogInput, tenantId: string) {
	return getRepos().activity.insertActivityLog(input, tenantId);
}
export async function findActivityLogById(id: string, tenantId: string) {
	return getRepos().activity.findActivityLogById(id, tenantId);
}
export async function markActivityLogCancelled(id: string, tenantId: string) {
	return getRepos().activity.markActivityLogCancelled(id, tenantId);
}
export async function findActivityLogs(
	childId: ChildId,
	tenantId: string,
	options?: { from?: string; to?: string },
) {
	return getRepos().activity.findActivityLogs(childId, tenantId, options);
}
export async function countTodayActiveRecords(
	childId: ChildId,
	activityId: ActivityId,
	date: string,
	tenantId: string,
) {
	return getRepos().activity.countTodayActiveRecords(childId, activityId, date, tenantId);
}
export async function getTodayActivityCountsByChild(
	childId: ChildId,
	date: string,
	tenantId: string,
) {
	return getRepos().activity.getTodayActivityCountsByChild(childId, date, tenantId);
}
async function _findTodayRecordedActivityIds(childId: ChildId, today: string, tenantId: string) {
	return getRepos().activity.findTodayRecordedActivityIds(childId, today, tenantId);
}

// Aggregation
export async function findDistinctRecordedDates(childId: ChildId, tenantId: string) {
	return getRepos().activity.findDistinctRecordedDates(childId, tenantId);
}
export async function countActiveActivityLogs(childId: ChildId, tenantId: string) {
	return getRepos().activity.countActiveActivityLogs(childId, tenantId);
}
async function _getCategoryCountsByDate(childId: ChildId, tenantId: string) {
	return getRepos().activity.getCategoryCountsByDate(childId, tenantId);
}
async function _countDistinctCategories(childId: ChildId, tenantId: string) {
	return getRepos().activity.countDistinctCategories(childId, tenantId);
}
export async function findTodayLogsWithCategory(childId: ChildId, date: string, tenantId: string) {
	return getRepos().activity.findTodayLogsWithCategory(childId, date, tenantId);
}
export async function getComboPointsGranted(
	childId: ChildId,
	descriptionPrefix: string,
	tenantId: string,
) {
	return getRepos().activity.getComboPointsGranted(childId, descriptionPrefix, tenantId);
}
async function _countActiveActivityLogsByCategory(
	childId: ChildId,
	categoryId: CategoryId,
	tenantId: string,
) {
	return getRepos().activity.countActiveActivityLogsByCategory(childId, categoryId, tenantId);
}
async function _countPointLedgerEntriesByType(childId: ChildId, type: string, tenantId: string) {
	return getRepos().activity.countPointLedgerEntriesByType(childId, type, tenantId);
}

export async function countPointLedgerEntriesByTypeAndDate(
	childId: ChildId,
	type: string,
	date: string,
	tenantId: string,
) {
	return getRepos().activity.countPointLedgerEntriesByTypeAndDate(childId, type, date, tenantId);
}
export async function sumPointLedgerByTypeAndDescriptionPrefix(
	childId: ChildId,
	type: string,
	descriptionPrefix: string,
	tenantId: string,
) {
	return getRepos().activity.sumPointLedgerByTypeAndDescriptionPrefix(
		childId,
		type,
		descriptionPrefix,
		tenantId,
	);
}

// #783: archive / restore
// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveActivities(
	ids: ActivityId[],
	reason: ArchivedReason,
	tenantId: string,
) {
	return getRepos().activity.archiveActivities(ids, reason, tenantId);
}
export async function restoreArchivedActivities(reason: ArchivedReason, tenantId: string) {
	return getRepos().activity.restoreArchivedActivities(reason, tenantId);
}

// #1755 (#1709-A): 「今日のおやくそく」(priority='must') 集計
export async function findMustActivitiesWithToday(
	childId: ChildId,
	today: string,
	tenantId: string,
) {
	return getRepos().activity.findMustActivitiesWithToday(childId, today, tenantId);
}

// Point Ledger
export async function insertPointLedger(input: InsertPointLedgerInput, tenantId: string) {
	return getRepos().activity.insertPointLedger(input, tenantId);
}
