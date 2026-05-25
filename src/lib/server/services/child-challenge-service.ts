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
	InsertChildChallengeInput,
} from '$lib/server/db/types';

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
 */
export async function buildPerChildTargets(
	baseTarget: number,
	ageAdjustments: Record<string, number> | undefined,
	childIds: readonly number[],
	tenantId: string,
): Promise<Record<number, number>> {
	const allChildren = await findAllChildren(tenantId);
	const result: Record<number, number> = {};
	for (const childId of childIds) {
		const child = allChildren.find((c) => c.id === childId);
		const age = child?.age ?? 6;
		result[childId] = calcAgeAdjustedTarget(baseTarget, ageAdjustments, age);
	}
	return result;
}
