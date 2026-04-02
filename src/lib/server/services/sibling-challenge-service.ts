// src/lib/server/services/sibling-challenge-service.ts
// きょうだいチャレンジ — 協力＆ライバル機能のサービス層

import { insertPointLedger } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import {
	claimReward as claimRewardRepo,
	deleteChallenge as deleteRepo,
	enrollChildren,
	findActiveChallenges,
	findAllChallenges,
	findChallengeById,
	findProgress,
	findProgressByChallenge,
	insertChallenge,
	markCompleted,
	updateChallenge,
	upsertProgress,
} from '$lib/server/db/sibling-challenge-repo';
import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeWithProgress,
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

/** 年齢に応じたターゲット値を計算 */
export function calcAgeAdjustedTarget(
	baseTarget: number,
	ageAdjustments: Record<string, number> | undefined,
	childAge: number,
): number {
	if (!ageAdjustments) return baseTarget;
	// 年齢に完全一致するキーがあればその値を使用
	const exact = ageAdjustments[String(childAge)];
	if (exact !== undefined) return exact;
	// なければ最も近い年齢のキーを使用
	const ages = Object.keys(ageAdjustments)
		.map(Number)
		.filter((n) => !Number.isNaN(n))
		.sort((a, b) => a - b);
	if (ages.length === 0) return baseTarget;
	// 子供の年齢以下で最大のキーを探す
	let closest = baseTarget;
	for (const age of ages) {
		if (age <= childAge) closest = ageAdjustments[String(age)] ?? baseTarget;
	}
	// 子供が最小キーより小さい場合はbaseTarget
	if (ages[0] !== undefined && childAge < ages[0]) return baseTarget;
	return closest;
}

/** チャレンジを作成し、全子供を自動エンロール */
export async function createSiblingChallenge(
	input: InsertSiblingChallengeInput,
	tenantId: string,
): Promise<SiblingChallenge> {
	const challenge = await insertChallenge(input, tenantId);
	const children = await findAllChildren(tenantId);

	const targetConfig: TargetConfig = JSON.parse(input.targetConfig);
	const enrollList = children.map((child) => ({
		childId: child.id,
		targetValue: calcAgeAdjustedTarget(
			targetConfig.baseTarget,
			targetConfig.ageAdjustments,
			child.age,
		),
	}));

	await enrollChildren(challenge.id, enrollList, tenantId);
	return challenge;
}

/** 管理画面用: 全チャレンジ（進捗付き） */
export async function getAllChallengesWithProgress(
	tenantId: string,
): Promise<SiblingChallengeWithProgress[]> {
	const challenges = await findAllChallenges(tenantId);
	const result: SiblingChallengeWithProgress[] = [];

	for (const challenge of challenges) {
		const progress = await findProgressByChallenge(challenge.id, tenantId);
		const allCompleted = progress.length > 0 && progress.every((p) => p.completed === 1);
		result.push({ ...challenge, progress, allCompleted });
	}

	return result;
}

/** 子供向け: アクティブチャレンジ＋進捗 */
export async function getActiveChallengesForChild(
	childId: number,
	tenantId: string,
): Promise<SiblingChallengeWithProgress[]> {
	const today = new Date().toISOString().slice(0, 10);
	const challenges = await findActiveChallenges(today, tenantId);
	const result: SiblingChallengeWithProgress[] = [];

	for (const challenge of challenges) {
		const progress = await findProgressByChallenge(challenge.id, tenantId);
		// 子供がエンロールされていなければ自動エンロール
		if (!progress.some((p) => p.childId === childId)) {
			const children = await findAllChildren(tenantId);
			const targetConfig: TargetConfig = JSON.parse(challenge.targetConfig);
			const child = children.find((c) => c.id === childId);
			if (child) {
				await enrollChildren(
					challenge.id,
					[
						{
							childId: child.id,
							targetValue: calcAgeAdjustedTarget(
								targetConfig.baseTarget,
								targetConfig.ageAdjustments,
								child.age,
							),
						},
					],
					tenantId,
				);
			}
			// リフレッシュ
			const refreshed = await findProgressByChallenge(challenge.id, tenantId);
			const allCompleted = refreshed.length > 0 && refreshed.every((p) => p.completed === 1);
			result.push({ ...challenge, progress: refreshed, allCompleted });
		} else {
			const allCompleted = progress.length > 0 && progress.every((p) => p.completed === 1);
			result.push({ ...challenge, progress, allCompleted });
		}
	}

	return result;
}

/** 活動記録時フック: チャレンジ進捗を更新 */
export async function checkChallengeProgress(
	childId: number,
	_activityId: number,
	categoryId: number,
	tenantId: string,
): Promise<{ challengeId: number; allSiblingsComplete: boolean; challengeTitle: string }[]> {
	const today = new Date().toISOString().slice(0, 10);
	const challenges = await findActiveChallenges(today, tenantId);
	const results: { challengeId: number; allSiblingsComplete: boolean; challengeTitle: string }[] =
		[];

	for (const challenge of challenges) {
		const targetConfig: TargetConfig = JSON.parse(challenge.targetConfig);

		// カテゴリフィルタ: 特定カテゴリ指定時、一致しなければスキップ
		if (targetConfig.categoryId && targetConfig.categoryId !== categoryId) {
			continue;
		}

		const progress = await findProgress(challenge.id, childId, tenantId);
		if (!progress || progress.completed === 1) continue;

		// metric=count の場合、インクリメント
		if (targetConfig.metric === 'count') {
			const newValue = progress.currentValue + 1;
			await upsertProgress(challenge.id, childId, newValue, progress.targetValue, tenantId);

			// ターゲット達成チェック
			if (newValue >= progress.targetValue) {
				await markCompleted(challenge.id, childId, tenantId);
			}
		}

		// 全きょうだい達成チェック
		const allProgress = await findProgressByChallenge(challenge.id, tenantId);
		const allComplete =
			allProgress.length > 0 &&
			allProgress.every(
				(p) =>
					p.completed === 1 ||
					(p.childId === childId && progress.currentValue + 1 >= progress.targetValue),
			);

		if (allComplete && challenge.status === 'active') {
			await updateChallenge(challenge.id, { status: 'completed' }, tenantId);
		}

		results.push({
			challengeId: challenge.id,
			allSiblingsComplete: allComplete,
			challengeTitle: challenge.title,
		});
	}

	return results;
}

/** 全きょうだい達成チェック */
export async function checkAllSiblingsComplete(
	challengeId: number,
	tenantId: string,
): Promise<boolean> {
	const progress = await findProgressByChallenge(challengeId, tenantId);
	return progress.length > 0 && progress.every((p) => p.completed === 1);
}

/** 報酬受取 */
export async function claimChallengeReward(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<{ points: number; message?: string } | { error: string }> {
	const challenge = await findChallengeById(challengeId, tenantId);
	if (!challenge) return { error: 'チャレンジが見つかりません' };

	// 協力チャレンジの場合、全員達成が必要
	if (challenge.challengeType === 'cooperative') {
		const allComplete = await checkAllSiblingsComplete(challengeId, tenantId);
		if (!allComplete) return { error: 'まだ全員クリアしていません' };
	} else {
		// 競争チャレンジの場合、自分が達成していればOK
		const progress = await findProgress(challengeId, childId, tenantId);
		if (!progress || progress.completed !== 1) return { error: 'まだクリアしていません' };
	}

	// 二重受取チェック
	const progress = await findProgress(challengeId, childId, tenantId);
	if (!progress) return { error: '参加していません' };
	if (progress.rewardClaimed === 1) return { error: 'すでに受け取り済みです' };

	const rewardConfig: RewardConfig = JSON.parse(challenge.rewardConfig);

	// ポイント付与
	await insertPointLedger(
		{
			childId,
			amount: rewardConfig.points,
			type: 'sibling_challenge',
			description: `きょうだいチャレンジ達成: ${challenge.title}`,
			referenceId: challengeId,
		},
		tenantId,
	);

	// 受取済みマーク
	await claimRewardRepo(challengeId, childId, tenantId);

	return { points: rewardConfig.points, message: rewardConfig.message };
}

/** チャレンジ削除 */
export async function deleteSiblingChallenge(id: number, tenantId: string): Promise<void> {
	await deleteRepo(id, tenantId);
}
