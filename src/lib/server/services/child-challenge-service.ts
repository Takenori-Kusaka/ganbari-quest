// src/lib/server/services/child-challenge-service.ts
// per-child チャレンジ サービス層 (#2362 PR-7、ADR-0055、User §6)
//
// 旧 sibling-challenge-service.ts (family-wide + 全員自動 enroll) の per-child 後継。
// 並存維持 (旧 service は cleanup #2458 まで残す)。
//
// 設計原則:
//   - 1 challenge instance = 1 child binding (per-child instance)
//   - 兄弟連動表示は sourceTemplateId / (title + startDate + endDate) で group
//   - Anti-engagement (ADR-0012): 全員完了で簡素な祝福のみ (admin 画面で表示)、
//     子供画面で兄弟比較を煽らない

import { todayDateJST } from '$lib/domain/date-utils';
import { insertPointLedger } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { getRepos } from '$lib/server/db/factory';
import type {
	ChildChallenge,
	ChildChallengeGroup,
	ChildChallengeWithSiblings,
	InsertChildChallengeInput,
} from '$lib/server/db/types';
import {
	aggregateCategoryCounts,
	CATEGORY_NAMES,
	type ChallengePrev,
	computeProposal,
	getLastWeekStart,
	getWeekEnd,
	getWeekStart,
} from '$lib/server/services/challenge-generation';

/** group key 解決 (admin getChallengeGroupsForAdmin と同一規約、ADR-0055 §4.7 整合) */
function resolveGroupKey(
	c: Pick<ChildChallenge, 'sourceTemplateId' | 'title' | 'startDate' | 'endDate'>,
): string {
	return c.sourceTemplateId ?? `${c.title}::${c.startDate}::${c.endDate}`;
}

interface TargetConfig {
	metric: 'count' | 'xp';
	categoryId?: number;
	activityId?: number;
	baseTarget: number;
	ageAdjustments?: Record<string, number>;
}

interface RewardConfig {
	points: number;
	message?: string;
}

/** 年齢に応じたターゲット値を計算 (旧 sibling-challenge-service の同等関数を再利用) */
export function calcAgeAdjustedTarget(
	baseTarget: number,
	ageAdjustments: Record<string, number> | undefined,
	childAge: number,
): number {
	if (!ageAdjustments) return baseTarget;
	const exact = ageAdjustments[String(childAge)];
	if (exact !== undefined) return exact;
	const ages = Object.keys(ageAdjustments)
		.map(Number)
		.filter((n) => !Number.isNaN(n))
		.sort((a, b) => a - b);
	if (ages.length === 0) return baseTarget;
	let closest = baseTarget;
	for (const age of ages) {
		if (age <= childAge) closest = ageAdjustments[String(age)] ?? baseTarget;
	}
	if (ages[0] !== undefined && childAge < ages[0]) return baseTarget;
	return closest;
}

/**
 * 1 child に 1 challenge instance 作成。
 * 親管理画面の「作成 (個別)」action から呼ばれる。
 */
export async function createChildChallenge(
	input: InsertChildChallengeInput,
	tenantId: string,
): Promise<ChildChallenge> {
	const repos = getRepos();
	return repos.childChallenge.insert(input, tenantId);
}

/**
 * 同じ challenge spec を複数 child に同時 instance 化 (一括追加 / ChildSelectionDialog の「全員に追加」)。
 * sourceTemplateId を共有することで admin/challenges で兄弟連動表示される。
 */
export async function createChildChallengesBulk(
	spec: Omit<InsertChildChallengeInput, 'childId' | 'targetValue'> & {
		sourceTemplateId?: string | null;
		/** 子供別 target value (age-adjusted)。childId → targetValue マップ */
		perChildTargets: Record<number, number>;
	},
	childIds: readonly number[],
	tenantId: string,
): Promise<ChildChallenge[]> {
	const repos = getRepos();
	const inputs: InsertChildChallengeInput[] = childIds.map((childId) => ({
		childId,
		title: spec.title,
		description: spec.description ?? null,
		challengeType: spec.challengeType ?? 'cooperative',
		periodType: spec.periodType ?? 'weekly',
		startDate: spec.startDate,
		endDate: spec.endDate,
		targetConfig: spec.targetConfig,
		rewardConfig: spec.rewardConfig,
		sourceTemplateId: spec.sourceTemplateId ?? null,
		targetValue: spec.perChildTargets[childId] ?? 1,
	}));
	return repos.childChallenge.insertBulk(inputs, tenantId);
}

/**
 * admin/challenges 画面: tenant 全体の challenge instance を sourceTemplateId / (title + 期間) で
 * group 化して返す。SiblingChallengeComparison.svelte で兄弟連動比較表示するため。
 */
export async function getChallengeGroupsForAdmin(tenantId: string): Promise<ChildChallengeGroup[]> {
	const repos = getRepos();
	const all = await repos.childChallenge.findAllByTenant(tenantId);

	const groupMap = new Map<string, ChildChallenge[]>();
	for (const c of all) {
		const key = c.sourceTemplateId ?? `${c.title}::${c.startDate}::${c.endDate}`;
		const arr = groupMap.get(key) ?? [];
		arr.push(c);
		groupMap.set(key, arr);
	}

	const groups: ChildChallengeGroup[] = [];
	for (const [groupKey, instances] of groupMap) {
		const first = instances[0];
		if (!first) continue;
		groups.push({
			groupKey,
			title: first.title,
			description: first.description,
			startDate: first.startDate,
			endDate: first.endDate,
			periodType: first.periodType,
			sourceTemplateId: first.sourceTemplateId,
			instances,
			allCompleted: instances.length > 0 && instances.every((i) => i.completed === 1),
		});
	}

	// 開始日降順 (新しい順) で表示
	groups.sort((a, b) => b.startDate.localeCompare(a.startDate));
	return groups;
}

// ============================================================
// アプリ週次自動生成 (#3195、EPIC #3193 child_challenges 一本化)
// 親手動作成に代わり、アプリが毎週 child_challenges を自動生成する。
// 生成アルゴリズム (苦手中心＋時々得意＋翌週適応) は auto-challenge-service の
// computeProposal を流用。child_challenges に書くことで既存の進捗フック
// (updateChildChallengeProgress) / 完了 / ごほうび受取 / バナー / 達成演出が
// そのまま生きる。生成メタ (mode / 連続未達) は targetConfig JSON に内包し
// child_challenges のスキーマ変更を不要にする。
// ============================================================

/** 自動生成 instance を識別する sourceTemplateId 値 */
const AUTO_WEEKLY_SOURCE = 'auto:weekly';
/** 自動生成チャレンジ達成時の既定ごほうびポイント (PO 確認対象、控えめな既定値) */
const AUTO_WEEKLY_REWARD_POINTS = 30;

/** 前週の自動生成 child_challenge を computeProposal の prev 入力 (ChallengePrev) に写像する。 */
function toProposalPrev(row: ChildChallenge): ChallengePrev {
	let categoryId = 1;
	let genMissStreak = 0;
	try {
		const cfg = JSON.parse(row.targetConfig) as {
			categoryId?: number;
			genMissStreak?: number;
		};
		categoryId = cfg.categoryId ?? 1;
		genMissStreak = cfg.genMissStreak ?? 0;
	} catch {
		// 破損 JSON は既定値で続行
	}
	return {
		categoryId,
		targetCount: row.targetValue,
		currentCount: row.currentValue,
		status: row.completed === 1 ? 'completed' : 'expired',
		consecutiveMissCount: genMissStreak,
	};
}

/**
 * 当週のアプリ自動生成 child_challenge を取得 (なければ生成)。子供 home / challenges の
 * load で呼び、バナー等に流す。冪等 (当週分が既にあれば再生成しない)。
 */
export async function getOrCreateWeeklyChildChallenge(
	childId: number,
	tenantId: string,
): Promise<ChildChallenge> {
	const repos = getRepos();
	const weekStart = getWeekStart();

	const all = await repos.childChallenge.findByChildId(childId, tenantId);
	const existing = all.find(
		(c) => c.sourceTemplateId === AUTO_WEEKLY_SOURCE && c.startDate === weekStart,
	);
	if (existing) return existing;

	const lastWeekStart = getLastWeekStart(weekStart);
	const prevRow = all.find(
		(c) => c.sourceTemplateId === AUTO_WEEKLY_SOURCE && c.startDate === lastWeekStart,
	);
	const counts = await aggregateCategoryCounts(childId, tenantId);
	const proposal = computeProposal(
		counts,
		prevRow ? toProposalPrev(prevRow) : undefined,
		weekStart,
	);

	const targetConfig = JSON.stringify({
		metric: 'count',
		categoryId: proposal.categoryId,
		baseTarget: proposal.targetCount,
		genMode: proposal.mode,
		genMissStreak: proposal.consecutiveMissCount,
	});
	const rewardConfig = JSON.stringify({
		points: AUTO_WEEKLY_REWARD_POINTS,
		message: proposal.reason,
	});

	return repos.childChallenge.insert(
		{
			childId,
			title: `今週は「${proposal.categoryName}」を${proposal.targetCount}回`,
			description: proposal.reason,
			challengeType: 'cooperative',
			periodType: 'weekly',
			startDate: weekStart,
			endDate: getWeekEnd(weekStart),
			targetConfig,
			rewardConfig,
			sourceTemplateId: AUTO_WEEKLY_SOURCE,
			targetValue: proposal.targetCount,
		},
		tenantId,
	);
}

/** 子供チャレンジページ (`/(child)/.../challenges`) 表示用の自動生成チャレンジ view。 */
export interface WeeklyChallengeView {
	id: number;
	categoryName: string;
	weekStart: string;
	status: string; // active | completed | expired
	currentCount: number;
	targetCount: number;
	progressPercent: number;
	description: string;
}

function toWeeklyView(row: ChildChallenge): WeeklyChallengeView {
	let categoryId = 0;
	try {
		categoryId = (JSON.parse(row.targetConfig) as { categoryId?: number }).categoryId ?? 0;
	} catch {
		// noop
	}
	const today = todayDateJST();
	const status = row.completed === 1 ? 'completed' : row.endDate >= today ? 'active' : 'expired';
	const progressPercent =
		row.targetValue > 0 ? Math.min(100, Math.round((row.currentValue / row.targetValue) * 100)) : 0;
	return {
		id: row.id,
		categoryName: CATEGORY_NAMES[categoryId] ?? '',
		weekStart: row.startDate,
		status,
		currentCount: row.currentValue,
		targetCount: row.targetValue,
		progressPercent,
		description: row.description ?? row.title,
	};
}

/**
 * 子供チャレンジページ向け: 当週分を冪等生成したうえで、active (当週) + history を返す。
 * `/(child)/.../challenges` の load が使う (#3213、旧 auto-challenge-service の後継)。
 */
export async function getWeeklyChildChallengeView(
	childId: number,
	tenantId: string,
	historyLimit = 10,
): Promise<{ activeChallenge: WeeklyChallengeView | null; history: WeeklyChallengeView[] }> {
	await getOrCreateWeeklyChildChallenge(childId, tenantId);
	const repos = getRepos();
	const weekStart = getWeekStart();
	const autoRows = (await repos.childChallenge.findByChildId(childId, tenantId))
		.filter((c) => c.sourceTemplateId === AUTO_WEEKLY_SOURCE)
		.sort((a, b) => b.startDate.localeCompare(a.startDate));

	const activeRow = autoRows.find((c) => c.startDate === weekStart) ?? null;
	const history = autoRows.filter((c) => c.startDate !== weekStart).slice(0, historyLimit);

	return {
		activeChallenge: activeRow ? toWeeklyView(activeRow) : null,
		history: history.map(toWeeklyView),
	};
}

/** 子供画面: 子供自身のアクティブ challenge 一覧 */
export async function getActiveChildChallenges(
	childId: number,
	tenantId: string,
): Promise<ChildChallenge[]> {
	const repos = getRepos();
	const today = todayDateJST();
	return repos.childChallenge.findActiveByChildId(childId, today, tenantId);
}

/**
 * #2458-B (caller migration): 子供画面 (home / history) 向け per-child instance 配列 +
 * 兄弟連動情報の付与。
 *
 * 旧 `sibling-challenge-service.getActiveChallengesForChild` の後継。
 *
 * 自身の active instance を主軸に、同じ group key (sourceTemplateId or `title::start::end`) を
 * 共有する兄弟 instance を `siblings` フィールドに格納。`ChallengeBanner` / `SiblingCelebration`
 * の UX 互換性を維持する。
 *
 * #2488 (must-1 fix): `findActiveOrUnclaimedByChildId` 経由で「完成済だが未請求」instance も
 * 含めるよう変更 (status='completed' AND rewardClaimed=0)。これにより `markCompleted` 直後に
 * instance が active 一覧から消えて claim ボタンが render されない regression を防ぐ。
 *
 * #2488 (must-2 fix): `siblings[]` は **同一 startDate + endDate** (同一期間) の instance に
 * 限定する。過去 expired instance や 別期間 (例: 先週分) の completed instance が
 * `sourceTemplateId` 共有経由で leak し `allCompleted=true` 誤判定 (= celebration 誤発火) を
 * 引き起こすため。
 *
 * IDOR / tenant 境界: `findActiveOrUnclaimedByChildId` / `findAllByTenant` ともに `tenantId`
 * 必須化済。自身の childId 以外の child instance は同一 tenant 内のみ含まれる。
 */
export async function getActiveChildChallengesWithSiblings(
	childId: number,
	tenantId: string,
): Promise<ChildChallengeWithSiblings[]> {
	const repos = getRepos();
	const today = todayDateJST();

	// 自身の active + 未請求完成 instance (#2488 must-1)
	const myActive = await repos.childChallenge.findActiveOrUnclaimedByChildId(
		childId,
		today,
		tenantId,
	);
	if (myActive.length === 0) return [];

	// tenant 全体 (同期間 + 同 group key の兄弟 instance を捕捉するため)
	const allTenant = await repos.childChallenge.findAllByTenant(tenantId);

	// group key → group 内全 instance の map (期間 filter は下で実施、#2488 must-2)
	const groupMap = new Map<string, ChildChallenge[]>();
	for (const c of allTenant) {
		const key = resolveGroupKey(c);
		const arr = groupMap.get(key) ?? [];
		arr.push(c);
		groupMap.set(key, arr);
	}

	return myActive.map((mine) => {
		const key = resolveGroupKey(mine);
		// #2488 must-2: siblings[] は同一 startDate + endDate (= 同一期間) の instance のみ
		// 含める。`sourceTemplateId` 共有の preset 過去期間 instance が混入し allCompleted を
		// 誤判定する regression を防ぐ。
		const siblings = (groupMap.get(key) ?? [mine]).filter(
			(s) => s.startDate === mine.startDate && s.endDate === mine.endDate,
		);
		// filter で自身が脱落しないよう (理論上ありえないが安全側) fallback
		const finalSiblings = siblings.length > 0 ? siblings : [mine];
		const allCompleted = finalSiblings.length > 0 && finalSiblings.every((s) => s.completed === 1);
		return { ...mine, siblings: finalSiblings, allCompleted };
	});
}

/**
 * 活動記録時の進捗更新フック。child の活動 1 件記録時に呼び出される。
 * 旧 sibling-challenge-service.checkChallengeProgress の per-child 後継。
 */
export async function updateChildChallengeProgress(
	childId: number,
	_activityId: number,
	categoryId: number,
	tenantId: string,
): Promise<{ challengeId: number; completed: boolean; challengeTitle: string }[]> {
	const repos = getRepos();
	const today = todayDateJST();
	const challenges = await repos.childChallenge.findActiveByChildId(childId, today, tenantId);
	const results: { challengeId: number; completed: boolean; challengeTitle: string }[] = [];

	for (const challenge of challenges) {
		if (challenge.completed === 1) continue;
		const targetConfig: TargetConfig = JSON.parse(challenge.targetConfig);
		if (targetConfig.categoryId && targetConfig.categoryId !== categoryId) continue;

		if (targetConfig.metric === 'count') {
			const newValue = challenge.currentValue + 1;
			await repos.childChallenge.updateProgress(challenge.id, newValue, tenantId);
			if (newValue >= challenge.targetValue) {
				await repos.childChallenge.markCompleted(challenge.id, tenantId);
				results.push({
					challengeId: challenge.id,
					completed: true,
					challengeTitle: challenge.title,
				});
				continue;
			}
		}
		results.push({ challengeId: challenge.id, completed: false, challengeTitle: challenge.title });
	}
	return results;
}

/** ごほうび受取 (per-child instance ごと) */
export async function claimChildChallengeReward(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<{ points: number; message?: string } | { error: string }> {
	const repos = getRepos();
	const challenge = await repos.childChallenge.findById(challengeId, tenantId);
	if (!challenge) return { error: 'チャレンジが見つかりません' };
	if (challenge.childId !== childId) return { error: 'このチャレンジは別のお子さま用です' };
	if (challenge.completed !== 1) return { error: 'まだクリアしていません' };
	if (challenge.rewardClaimed === 1) return { error: 'すでに受け取り済みです' };

	const rewardConfig: RewardConfig = JSON.parse(challenge.rewardConfig);
	await insertPointLedger(
		{
			childId,
			amount: rewardConfig.points,
			type: 'child_challenge',
			description: `チャレンジ達成: ${challenge.title}`,
			referenceId: challengeId,
		},
		tenantId,
	);
	await repos.childChallenge.claimReward(challengeId, tenantId);
	return { points: rewardConfig.points, message: rewardConfig.message };
}

/** 削除 (admin 画面から) */
export async function deleteChildChallenge(id: number, tenantId: string): Promise<void> {
	const repos = getRepos();
	await repos.childChallenge.deleteChallenge(id, tenantId);
}

/**
 * age-adjusted target を計算するヘルパー (全 child 分の childId → targetValue マップを構築)。
 * marketplace 取込 + admin 一括追加で使用。
 *
 * #2488 (must-3 fix): loop 内呼出時の N+1 query 解消のため、pre-fetched children 配列を
 * 受け取る overload を追加。caller 側で `findAllChildren(tenantId)` を 1 回だけ実行し、
 * 配列を渡すこと。配列省略時は従来通り内部で 1 回 fetch する。
 */
export async function buildPerChildTargets(
	baseTarget: number,
	ageAdjustments: Record<string, number> | undefined,
	childIds: readonly number[],
	tenantId: string,
	prefetchedChildren?: readonly { id: number; age: number }[],
): Promise<Record<number, number>> {
	const allChildren = prefetchedChildren ?? (await findAllChildren(tenantId));
	const result: Record<number, number> = {};
	for (const childId of childIds) {
		const child = allChildren.find((c) => c.id === childId);
		const age = child?.age ?? 6;
		result[childId] = calcAgeAdjustedTarget(baseTarget, ageAdjustments, age);
	}
	return result;
}
