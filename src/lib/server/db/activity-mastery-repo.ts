import type { ActivityId, ChildId } from '$lib/domain/ids';
// src/lib/server/db/activity-mastery-repo.ts
// 活動習熟度リポジトリ（Facade）

import { getRepos } from './factory';
import type { ActivityMastery } from './types';

export async function findByChildAndActivity(
	childId: ChildId,
	activityId: ActivityId,
	tenantId: string,
): Promise<ActivityMastery | undefined> {
	return getRepos().activityMastery.findByChildAndActivity(childId, activityId, tenantId);
}

async function _findAllByChild(childId: ChildId, tenantId: string): Promise<ActivityMastery[]> {
	return getRepos().activityMastery.findAllByChild(childId, tenantId);
}

export async function upsert(
	childId: ChildId,
	activityId: ActivityId,
	totalCount: number,
	level: number,
	tenantId: string,
): Promise<ActivityMastery> {
	return getRepos().activityMastery.upsert(childId, activityId, totalCount, level, tenantId);
}
