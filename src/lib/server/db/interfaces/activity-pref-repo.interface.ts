import type { ActivityUsageCount, ChildActivityPreference } from '../types';

export interface IActivityPrefRepo {
	findPinnedByChild(childId: number, tenantId: string): Promise<ChildActivityPreference[]>;
	togglePin(
		childId: number,
		activityId: number,
		pinned: boolean,
		tenantId: string,
	): Promise<ChildActivityPreference>;
	countPinnedInCategory(childId: number, categoryId: number, tenantId: string): Promise<number>;
	getUsageCounts(
		childId: number,
		sinceDate: string,
		tenantId: string,
	): Promise<ActivityUsageCount[]>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
