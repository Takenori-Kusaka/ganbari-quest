import type { GradeLevel, Source } from '$lib/domain/validation/activity';
import {
	countMainQuestActivities as countMainQuestActivitiesRepo,
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
	triggerHint?: string | null;
}

export interface ActivityFilter {
	childAge?: number;
	categoryId?: number;
	includeHidden?: boolean;
}

export async function getActivities(tenantId: string, filter?: ActivityFilter) {
	return await findActivities(tenantId, filter);
}

export async function getActivityById(id: number, tenantId: string) {
	return await findActivityById(id, tenantId);
}

export async function createActivity(input: CreateActivityInput, tenantId: string) {
	return await insertActivity(input, tenantId);
}

export async function updateActivity(
	id: number,
	input: Partial<CreateActivityInput>,
	tenantId: string,
) {
	return await updateActivityRepo(id, input, tenantId);
}

export async function setActivityVisibility(id: number, visible: boolean, tenantId: string) {
	return await setActivityVisibilityRepo(id, visible, tenantId);
}

async function _deleteActivity(id: number, tenantId: string) {
	return await deleteActivityRepo(id, tenantId);
}

export async function hasActivityLogs(activityId: number, tenantId: string): Promise<boolean> {
	return await hasActivityLogsRepo(activityId, tenantId);
}

export async function getActivityLogCounts(tenantId: string): Promise<Record<number, number>> {
	return await getActivityLogCountsRepo(tenantId);
}

export async function deleteActivityWithCleanup(id: number, tenantId: string) {
	await deleteDailyMissionsByActivity(id, tenantId);
	return await deleteActivityRepo(id, tenantId);
}

export const MAIN_QUEST_MAX = 3;

export async function setMainQuest(
	id: number,
	enabled: boolean,
	tenantId: string,
): Promise<{ success: true } | { error: string }> {
	if (enabled) {
		const currentCount = await countMainQuestActivitiesRepo(tenantId);
		if (currentCount >= MAIN_QUEST_MAX) {
			return { error: `メインクエストは${MAIN_QUEST_MAX}つまで設定できます` };
		}
	}
	const updated = await updateActivityRepo(id, { isMainQuest: enabled ? 1 : 0 }, tenantId);
	if (!updated) return { error: '活動が見つかりません' };
	return { success: true };
}

export async function getMainQuestCount(tenantId: string): Promise<number> {
	return await countMainQuestActivitiesRepo(tenantId);
}
