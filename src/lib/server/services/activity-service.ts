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

export async function getActivities(filter?: ActivityFilter) {
	return await findActivities(filter);
}

export async function getActivityById(id: number) {
	return await findActivityById(id);
}

export async function createActivity(input: CreateActivityInput) {
	return await insertActivity(input);
}

export async function updateActivity(id: number, input: Partial<CreateActivityInput>) {
	return await updateActivityRepo(id, input);
}

export async function setActivityVisibility(id: number, visible: boolean) {
	return await setActivityVisibilityRepo(id, visible);
}

export async function deleteActivity(id: number) {
	return await deleteActivityRepo(id);
}

export async function hasActivityLogs(activityId: number): Promise<boolean> {
	return await hasActivityLogsRepo(activityId);
}

export async function getActivityLogCounts(): Promise<Record<number, number>> {
	return await getActivityLogCountsRepo();
}

export async function deleteActivityWithCleanup(id: number) {
	await deleteDailyMissionsByActivity(id);
	return await deleteActivityRepo(id);
}
