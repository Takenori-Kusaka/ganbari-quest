import type { GradeLevel, Source } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier-types';
import {
	countMainQuestActivities as countMainQuestActivitiesRepo,
	deleteActivity as deleteActivityRepo,
	deleteDailyMissionsByActivity,
	findActivities,
	findActivityById,
	findMustActivitiesWithToday,
	getActivityLogCounts as getActivityLogCountsRepo,
	hasActivityLogs as hasActivityLogsRepo,
	insertActivity,
	setActivityVisibility as setActivityVisibilityRepo,
	updateActivity as updateActivityRepo,
} from '$lib/server/db/activity-repo';
import type { ActivityPriority } from '$lib/server/db/types';

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
	// #1755 (#1709-A): 「今日のおやくそく」優先度（既定 'optional'）
	priority?: ActivityPriority;
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

// ============================================================
// #1755 (#1709-A): 「今日のおやくそく」(activities.priority='must')
// ============================================================

/**
 * 子供の today に対する「今日のおやくそく」達成状況を返す。
 *
 * @param childId 対象の子供 id
 * @param today  YYYY-MM-DD（達成判定に使う日付）
 * @returns logged: 今日達成した must 活動数 / total: must 活動の総数 /
 *          activities: must 活動 + 今日記録済みフラグ
 */
export async function getMustActivitiesToday(
	childId: number,
	today: string,
	tenantId: string,
): Promise<{
	logged: number;
	total: number;
	activities: Array<{ id: number; name: string; icon: string; loggedToday: number }>;
}> {
	return await findMustActivitiesWithToday(childId, today, tenantId);
}

/**
 * 「今日のおやくそく」全達成時のボーナスポイントを返す。
 *
 * - preschool: 5pt
 * - elementary: 5pt
 * - junior: 3pt
 * - senior: 3pt
 * - baby: 0pt（baby 準備モードはゲーミフィケーション不適用 — ADR-0011）
 * - 全達成でない場合は 0pt
 *
 * 後続 sub-issue（1709-B/C）の UI 側 / hook 側がこの計算を呼ぶ。
 */
export function computeMustCompletionBonus(uiMode: UiMode, allComplete: boolean): number {
	if (!allComplete) return 0;
	switch (uiMode) {
		case 'preschool':
		case 'elementary':
			return 5;
		case 'junior':
		case 'senior':
			return 3;
		default:
			return 0;
	}
}
