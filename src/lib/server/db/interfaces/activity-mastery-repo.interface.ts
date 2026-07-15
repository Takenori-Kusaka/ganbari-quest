import type { ActivityId, ChildId } from '$lib/domain/ids';
import type { ActivityMastery } from '../types';

export interface IActivityMasteryRepo {
	findByChildAndActivity(
		childId: ChildId,
		activityId: ActivityId,
		tenantId: string,
	): Promise<ActivityMastery | undefined>;
	findAllByChild(childId: ChildId, tenantId: string): Promise<ActivityMastery[]>;
	upsert(
		childId: ChildId,
		activityId: ActivityId,
		totalCount: number,
		level: number,
		tenantId: string,
	): Promise<ActivityMastery>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}
