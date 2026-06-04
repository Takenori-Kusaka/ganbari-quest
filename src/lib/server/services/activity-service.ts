import type { GradeLevel, Source } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier-types';
import {
	countPointLedgerEntriesByTypeAndDate,
	deleteDailyMissionsByActivity,
	findMustActivitiesWithToday,
	getActivityLogCounts as getActivityLogCountsRepo,
	hasActivityLogs as hasActivityLogsRepo,
	insertPointLedger,
} from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { getRepos } from '$lib/server/db/factory';
import type {
	ActivityPriority,
	Child,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '$lib/server/db/types';

// ============================================================
// #2362 PR-3 Phase 7b-2b — per-child instance への内部移行 (signature 不変 wrapper)
// ============================================================
//
// 本 service の master 系 9 method (getActivities / getActivityById / createActivity /
// updateActivity / setActivityVisibility / deleteActivityWithCleanup / setMainQuest /
// getMainQuestCount / `_deleteActivity`) は外部 signature を維持したまま、
// 内部実装を `getRepos().childActivity` 経由に rewrite している (ADR-0055)。
//
// 設計判断:
//   - signature 不変原則: 30+ files の callsite を破壊しないため signature `(id, tenantId)`
//     を堅持。childId が必要な childActivity API は internal helper
//     `_resolveChildIdForActivity` で activity_id → childId 逆引きする (全 child を loop
//     で `findActivitiesByChild` し id match を探す)。
//   - 戻り値: 旧 `Activity` 型から `ChildActivity` 型へ。差分フィールド
//     (`ageMin / ageMax / gradeLevel / subcategory / description`) は ChildActivity に
//     存在しないため、callsite 側のフィールドアクセスは Phase 7b-2c (test/callsite 追従) で
//     対応する。本 phase では型互換性を service 層で吸収。
//   - tenant 集約: `getActivities(tenantId)` 等は `findAllChildren` + per-child loop で
//     集約 (Phase 7b-1 と同パターン、cloud-export / plan-limit / tenant-cleanup 整合)。
//   - log/point_ledger 系 (`hasActivityLogs` / `getActivityLogCounts` /
//     `findMustActivitiesWithToday` / `countPointLedgerEntriesByTypeAndDate` /
//     `insertPointLedger` / `deleteDailyMissionsByActivity`) は schema FK 切替済で
//     意味論不変のため、引き続き activity-repo facade 経由 (内部は child_activities.id 参照)。
//
// 既知の制約:
//   - `createActivity` は新規作成時に activity_id が無く逆引き不可能。Phase 7b-2c で
//     callsite 側に childId を渡す signature 拡張が必要だが、本 phase では
//     既存 `CreateActivityInput` を尊重するため、最も古い (= 一番上の sortOrder) child
//     に作成する暫定動作とする。Phase 7b-2c で全 callsite に childId を渡す。
//
// 関連:
//   - PR #2455 (本 PR-3) / Issue #2362
//   - docs/decisions/0055-per-child-primary-data-model-pattern.md
//   - docs/design/data-model-resource-scope.md §4.1

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

// ============================================================
// Internal helpers (per-child instance への wrapper 共通機構)
// ============================================================

/**
 * tenant 全 child の per-child activity を集約取得する。
 * `getActivities` / `getMainQuestCount` 等の tenant-wide aggregate 用。
 *
 * @param tenantId tenant id
 * @param options.includeHidden 既定 false (isVisible=1 のみ)
 * @param options.includeArchived 既定 false
 */
async function _collectAllChildActivities(
	tenantId: string,
	options?: { includeHidden?: boolean; includeArchived?: boolean },
): Promise<{ children: Child[]; activities: ChildActivity[] }> {
	const children = await findAllChildren(tenantId);
	const repos = getRepos();
	const all: ChildActivity[] = [];
	for (const child of children) {
		const acts = await repos.childActivity.findActivitiesByChild(child.id, tenantId, {
			includeArchived: options?.includeArchived ?? false,
			visibleOnly: !options?.includeHidden,
		});
		all.push(...acts);
	}
	return { children, activities: all };
}

/**
 * activity_id から childId を逆引きする。
 * tenant 全 child を loop して `findActivityById(id, child.id, tenantId)` を試行し、
 * 見つかった child.id を返す。tenant 内に存在しなければ undefined。
 *
 * archived 含む全件を対象とする (delete / restore 等の操作用)。
 *
 * NOTE (Phase 7b-2c 検討事項): N+1 cost (per call で全 child 線形探索) を許容する。
 * 1 家族あたり child 数は実運用上 1〜4 件程度のため、production パフォーマンス影響は軽微。
 * 大規模化時は ChildActivity に tenant index を追加し直接 join するよう refactor 可能。
 */
async function _resolveChildIdForActivity(
	id: number,
	tenantId: string,
): Promise<number | undefined> {
	const children = await findAllChildren(tenantId);
	const repos = getRepos();
	for (const child of children) {
		const found = await repos.childActivity.findActivityById(id, child.id, tenantId);
		if (found) return child.id;
	}
	return undefined;
}

/**
 * `CreateActivityInput` (Activity master 型) を `InsertChildActivityInput` に変換。
 *
 * ageMin / ageMax / gradeLevel / subcategory / description / dailyLimit / source /
 * nameKana / nameKanji は ChildActivity に存在しないため drop。Phase 7b-2c で
 * callsite 側で渡されなくなる想定。
 */
function _toChildActivityInsertInput(
	input: CreateActivityInput,
	childId: number,
): InsertChildActivityInput {
	return {
		childId,
		name: input.name,
		categoryId: input.categoryId,
		icon: input.icon,
		basePoints: input.basePoints,
		triggerHint: input.triggerHint ?? null,
		priority: input.priority,
	};
}

/**
 * `Partial<CreateActivityInput>` を `UpdateChildActivityInput` に変換。
 */
function _toChildActivityUpdateInput(
	input: Partial<CreateActivityInput> & { isMainQuest?: number },
): UpdateChildActivityInput {
	const update: UpdateChildActivityInput = {};
	if (input.name !== undefined) update.name = input.name;
	if (input.categoryId !== undefined) update.categoryId = input.categoryId;
	if (input.icon !== undefined) update.icon = input.icon;
	if (input.basePoints !== undefined) update.basePoints = input.basePoints;
	if (input.triggerHint !== undefined) update.triggerHint = input.triggerHint;
	if (input.isMainQuest !== undefined) update.isMainQuest = input.isMainQuest;
	if (input.priority !== undefined) update.priority = input.priority;
	return update;
}

// ============================================================
// Public API — signature 不変、内部 childActivity 経由
// ============================================================

export async function getActivities(tenantId: string, filter?: ActivityFilter) {
	const { activities } = await _collectAllChildActivities(tenantId, {
		includeHidden: filter?.includeHidden ?? false,
		includeArchived: false,
	});
	if (filter?.categoryId !== undefined) {
		return activities.filter((a) => a.categoryId === filter.categoryId);
	}
	return activities;
}

/**
 * #2471: 指定 child 1 人分の activity 一覧を取得する per-child API。
 *
 * 子供 home (`/(child)/[uiMode]/home`) / setup/first-adventure 等、
 * 現在の child context が確定している経路から呼ぶ。
 *
 * `getActivities(tenantId)` は tenant 全 child を集約する aggregate API のため、
 * 子供 home から呼ぶと 4 children なら最大 4 倍に同名 activity が重複 render される
 * UX 退行 bug が発生した (#2471、PR #2455 Round 6 で発覚)。
 *
 * ADR-0055 §3.1「childId 必須引数化で cross-child cross access を構造的に防ぐ」整合。
 * 内部実装は `IChildActivityRepo.findActivitiesByChild(childId, tenantId, options)` 直呼び。
 *
 * @param childId 対象 child id (cross-child access 防止)
 * @param tenantId tenant id (multi-tenant isolation)
 * @param filter `includeHidden` (default false = visibleOnly=true) /
 *               `categoryId` (post-filter) は `getActivities` 同様にサポート。
 *               `childAge` は per-child instance では不要 (instance 化時点で適齢)、
 *               signature 互換のため受け取るが filter 適用はしない。
 */
export async function getChildActivities(
	childId: number,
	tenantId: string,
	filter?: ActivityFilter,
): Promise<ChildActivity[]> {
	const repos = getRepos();
	const activities = await repos.childActivity.findActivitiesByChild(childId, tenantId, {
		visibleOnly: !(filter?.includeHidden ?? false),
		includeArchived: false,
	});
	if (filter?.categoryId !== undefined) {
		return activities.filter((a) => a.categoryId === filter.categoryId);
	}
	return activities;
}

export async function getActivityById(id: number, tenantId: string) {
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	return getRepos().childActivity.findActivityById(id, childId, tenantId);
}

export async function createActivity(
	input: CreateActivityInput,
	tenantId: string,
	childId?: number,
) {
	// #2902 Phase A: 作成先 child を明示できる optional 第 3 引数 childId を追加。
	// admin/activities は選択中タブの child に作成する (single-axis 表示と一致し、
	// 「追加したのに別の子のタブに出る」混乱を防ぐ)。childId 未指定の旧 callsite
	// (api/v1/activities 等) は従来通り一番古い child (sortOrder 最小 = findAllChildren
	// の先頭) に作成する後方互換 fallback。tenant に child が 0 件なら error。
	const children = await findAllChildren(tenantId);
	if (children.length === 0) {
		throw new Error('createActivity: tenant に child が存在しないため作成不可');
	}
	// 指定 childId が当該 tenant に属する場合のみ採用 (cross-tenant / 不正 id を弾く)。
	const targetChild = childId != null ? children.find((c) => c.id === childId) : undefined;
	const resolvedChild = targetChild ?? children[0];
	if (!resolvedChild) {
		throw new Error('createActivity: tenant に child が存在しないため作成不可');
	}
	return getRepos().childActivity.insertActivity(
		_toChildActivityInsertInput(input, resolvedChild.id),
		tenantId,
	);
}

export async function updateActivity(
	id: number,
	input: Partial<CreateActivityInput> & { isMainQuest?: number },
	tenantId: string,
) {
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	return getRepos().childActivity.updateActivity(
		id,
		childId,
		_toChildActivityUpdateInput(input),
		tenantId,
	);
}

export async function setActivityVisibility(id: number, visible: boolean, tenantId: string) {
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	return getRepos().childActivity.setActivityVisibility(id, childId, visible, tenantId);
}

async function _deleteActivity(id: number, tenantId: string) {
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return undefined;
	return getRepos().childActivity.deleteActivity(id, childId, tenantId);
}

export async function hasActivityLogs(activityId: number, tenantId: string): Promise<boolean> {
	return await hasActivityLogsRepo(activityId, tenantId);
}

export async function getActivityLogCounts(tenantId: string): Promise<Record<number, number>> {
	return await getActivityLogCountsRepo(tenantId);
}

export async function deleteActivityWithCleanup(id: number, tenantId: string) {
	await deleteDailyMissionsByActivity(id, tenantId);
	return await _deleteActivity(id, tenantId);
}

export const MAIN_QUEST_MAX = 3;

export async function setMainQuest(
	id: number,
	enabled: boolean,
	tenantId: string,
): Promise<{ success: true } | { error: string }> {
	if (enabled) {
		const currentCount = await getMainQuestCount(tenantId);
		if (currentCount >= MAIN_QUEST_MAX) {
			return { error: `メインクエストは${MAIN_QUEST_MAX}つまで設定できます` };
		}
	}
	const childId = await _resolveChildIdForActivity(id, tenantId);
	if (childId === undefined) return { error: '活動が見つかりません' };
	const updated = await getRepos().childActivity.updateActivity(
		id,
		childId,
		{ isMainQuest: enabled ? 1 : 0 },
		tenantId,
	);
	if (!updated) return { error: '活動が見つかりません' };
	return { success: true };
}

export async function getMainQuestCount(tenantId: string): Promise<number> {
	// childActivity.countMainQuestActivities は per-child しか取れないため
	// 全 child を loop で集約する (signature 不変)。
	// NOTE: tenant-wide MAIN_QUEST_MAX 制約の意味論は Phase 7b-1 / PO 判断 1 で「tenant-wide
	// 合計上限」を維持と確定。プラン別制限は別 Issue #2457 で扱う。
	const children = await findAllChildren(tenantId);
	const repos = getRepos();
	let total = 0;
	for (const child of children) {
		total += await repos.childActivity.countMainQuestActivities(child.id, tenantId);
	}
	return total;
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
