import type { GradeLevel, Source } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier-types';
import {
	countMainQuestActivities as countMainQuestActivitiesRepo,
	countPointLedgerEntriesByTypeAndDate,
	deleteActivity as deleteActivityRepo,
	deleteDailyMissionsByActivity,
	findActivities,
	findActivityById,
	findMustActivitiesWithToday,
	getActivityLogCounts as getActivityLogCountsRepo,
	hasActivityLogs as hasActivityLogsRepo,
	insertActivity,
	insertPointLedger,
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

/**
 * #1757 (#1709-C): point_ledger.type 識別子。
 * 1 子供 × 1 日に 1 件のみ加算される（冪等性 — ADR-0012 連続演出禁止 / 重複加算禁止）。
 */
export const MUST_COMPLETION_BONUS_TYPE = 'must_completion_bonus';

/**
 * #1757 (#1709-C): 「今日のおやくそく」全達成時のボーナスを冪等に付与する。
 *
 * 動作:
 * 1. `getMustActivitiesToday(childId, today, tenantId)` で達成状況を取得
 * 2. `total === 0` または `logged < total` → 付与せず返却（granted=false, points=0）
 * 3. `logged === total && total > 0`:
 *    - 同日にすでに付与済み（`countPointLedgerEntriesByTypeAndDate` > 0）→ 付与せず返却
 *    - 未付与かつ uiMode に応じた bonus > 0 → point_ledger に挿入
 *
 * 冪等性:
 * - point_ledger を `(childId, type='must_completion_bonus', date(createdAt)=today)` で
 *   1 行のみに保つ。同日 2 回目以降の呼び出しは加算しない。
 *
 * Anti-engagement (ADR-0012):
 * - 連続演出禁止 → 同日 2 回目以降の達成判定で再演出しないよう、`granted=false` を返す。
 * - 演出は呼び出し側 UI で 1 回のみ pulse + toast (1.5 秒以内) として実装する。
 *
 * 戻り値:
 * - `logged` / `total` — 達成状況（UI バー描画用）
 * - `allComplete` — `total > 0 && logged === total`
 * - `granted` — 本呼び出しで実際に DB に書き込んだか（true なら toast 演出を出す）
 * - `points` — 付与されたボーナス（granted=false なら 0）
 * - `activities` — must 活動 + 今日記録済みフラグ（呼び出し側で UI 表示に使う場合）
 */
export async function tryGrantMustCompletionBonus(
	childId: number,
	today: string,
	uiMode: UiMode,
	tenantId: string,
): Promise<{
	logged: number;
	total: number;
	allComplete: boolean;
	granted: boolean;
	points: number;
	activities: Array<{ id: number; name: string; icon: string; loggedToday: number }>;
}> {
	const { logged, total, activities } = await getMustActivitiesToday(childId, today, tenantId);
	const allComplete = total > 0 && logged === total;

	if (!allComplete) {
		return { logged, total, allComplete: false, granted: false, points: 0, activities };
	}

	const bonus = computeMustCompletionBonus(uiMode, true);
	if (bonus <= 0) {
		// baby 等ボーナス対象外モード → 達成のみ返す（演出はしない）
		return { logged, total, allComplete: true, granted: false, points: 0, activities };
	}

	const existingCount = await countPointLedgerEntriesByTypeAndDate(
		childId,
		MUST_COMPLETION_BONUS_TYPE,
		today,
		tenantId,
	);
	if (existingCount > 0) {
		return { logged, total, allComplete: true, granted: false, points: 0, activities };
	}

	await insertPointLedger(
		{
			childId,
			amount: bonus,
			type: MUST_COMPLETION_BONUS_TYPE,
			description: `[${today}] きょうのおやくそく ぜんぶできた！`,
		},
		tenantId,
	);

	return { logged, total, allComplete: true, granted: true, points: bonus, activities };
}
