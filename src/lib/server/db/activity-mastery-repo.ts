// src/lib/server/db/activity-mastery-repo.ts
// 活動習熟度リポジトリ（Facade）

import { getRepos } from './factory';
import type { ActivityMastery } from './types';

export async function findByChildAndActivity(
	childId: number,
	activityId: number,
	tenantId: string,
): Promise<ActivityMastery | undefined> {
	return getRepos().activityMastery.findByChildAndActivity(childId, activityId, tenantId);
}

async function findAllByChild(
	childId: number,
	tenantId: string,
): Promise<ActivityMastery[]> {
	return getRepos().activityMastery.findAllByChild(childId, tenantId);
}

export async function upsert(
	childId: number,
	activityId: number,
	totalCount: number,
	level: number,
	tenantId: string,
): Promise<ActivityMastery> {
	return getRepos().activityMastery.upsert(childId, activityId, totalCount, level, tenantId);
}
