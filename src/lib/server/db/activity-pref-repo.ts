import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
// src/lib/server/db/activity-pref-repo.ts
// 子供×活動ピン留め設定リポジトリ（Facade）

import { getRepos } from './factory';
import type { ActivityUsageCount, ChildActivityPreference } from './types';

export async function findPinnedByChild(
	childId: ChildId,
	tenantId: string,
): Promise<ChildActivityPreference[]> {
	return getRepos().activityPref.findPinnedByChild(childId, tenantId);
}

export async function togglePin(
	childId: ChildId,
	activityId: ActivityId,
	pinned: boolean,
	tenantId: string,
): Promise<ChildActivityPreference> {
	return getRepos().activityPref.togglePin(childId, activityId, pinned, tenantId);
}

export async function countPinnedInCategory(
	childId: ChildId,
	categoryId: CategoryId,
	tenantId: string,
): Promise<number> {
	return getRepos().activityPref.countPinnedInCategory(childId, categoryId, tenantId);
}

export async function getUsageCounts(
	childId: ChildId,
	sinceDate: string,
	tenantId: string,
): Promise<ActivityUsageCount[]> {
	return getRepos().activityPref.getUsageCounts(childId, sinceDate, tenantId);
}
