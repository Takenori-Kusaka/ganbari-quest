import type { GradeLevel, Source } from '$lib/domain/validation/activity';
import {
	deleteActivity as deleteActivityRepo,
	deleteDailyMissionsByActivity,
	findActivities,
	findActivityById,
	getActivityLogCounts as getActivityLogCountsRepo,
	hasActivityLogs as hasActivityLogsRepo,
	insertActivity,
	setActivityVisibility as setActivityVisibilityRepo,
	updateActivity as updateActivityRepo,
} from '$lib/server/db/activity-repo';

export interface CreateActivityInput {
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
	source?: Source;
	gradeLevel?: GradeLevel | null;
	subcategory?: string | null;
	description?: string | null;
	dailyLimit?: number | null;
	nameKana?: string | null;
	nameKanji?: string | null;
}

export interface ActivityFilter {
	childAge?: number;
	categoryId?: number;
	includeHidden?: boolean;
}

export function getActivities(filter?: ActivityFilter) {
	return findActivities(filter);
}

export function getActivityById(id: number) {
	return findActivityById(id);
}

export function createActivity(input: CreateActivityInput) {
	return insertActivity(input);
}

export function updateActivity(id: number, input: Partial<CreateActivityInput>) {
	return updateActivityRepo(id, input);
}

export function setActivityVisibility(id: number, visible: boolean) {
	return setActivityVisibilityRepo(id, visible);
}

export function deleteActivity(id: number) {
	return deleteActivityRepo(id);
}

export function hasActivityLogs(activityId: number): boolean {
	return hasActivityLogsRepo(activityId);
}

export function getActivityLogCounts(): Record<number, number> {
	return getActivityLogCountsRepo();
}

export function deleteActivityWithCleanup(id: number) {
	deleteDailyMissionsByActivity(id);
	return deleteActivityRepo(id);
}
