import type { ActivityMastery } from '../types';

export interface IActivityMasteryRepo {
	findByChildAndActivity(
		childId: number,
		activityId: number,
		tenantId: string,
	): Promise<ActivityMastery | undefined>;
	findAllByChild(childId: number, tenantId: string): Promise<ActivityMastery[]>;
	upsert(
		childId: number,
		activityId: number,
		totalCount: number,
		level: number,
		tenantId: string,
	): Promise<ActivityMastery>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
