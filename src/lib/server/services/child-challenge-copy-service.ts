// src/lib/server/services/child-challenge-copy-service.ts
// 兄弟共通化 UX (#2362 PR-7、ADR-0055、User §6)
//
// source child の child_challenges を target children (配列) に複製作成する専用 Service。
// SRP に従い「per-child instance の cross-child copy」のみを責務とする。
//
// PR-3 (activity copy) と同型 pattern。取込時の per-child 配信は
// child-challenge-service.createChildChallengesBulk が担い、本 Service は
// 既に作成済の challenge instance の「兄弟への波及」UI から呼ばれる:
//
//   1. 「他の子供から copy」action: source → target 1 名
//   2. 「全員に同期」action: source → 他兄弟全員 (新規 child 追加後の一括展開)
//
// 関連:
//   - docs/decisions/0055-per-child-primary-data-model-pattern.md
//   - docs/design/data-model-resource-scope.md §4.7
//   - src/lib/server/db/interfaces/child-challenge-repo.interface.ts (copyAcrossChildren)

import { getRepos } from '$lib/server/db/factory';
import type { ChildChallenge } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

export interface CopyChildChallengesContext {
	tenantId: string;
	sourceChildId: number;
	targetChildIds: readonly number[];
}

export interface CopyChildChallengesResult {
	totalCopied: number;
	byTargetChild: Record<number, number>;
	errors: { targetChildId: number; message: string }[];
}

export async function copyChildChallengesToSiblings(
	ctx: CopyChildChallengesContext,
): Promise<CopyChildChallengesResult> {
	const { tenantId, sourceChildId, targetChildIds } = ctx;
	const repos = getRepos();

	const byTargetChild: Record<number, number> = {};
	const errors: { targetChildId: number; message: string }[] = [];
	let totalCopied = 0;

	const targets = targetChildIds.filter((id) => id !== sourceChildId);
	if (targets.length !== targetChildIds.length) {
		logger.warn(
			'[child-challenge-copy-service] self-copy を除外 (sourceChildId と同一の targetChildId)',
			{
				context: { tenantId, sourceChildId, originalTargetCount: targetChildIds.length },
			},
		);
	}

	for (const targetChildId of targets) {
		try {
			const copied = await repos.childChallenge.copyAcrossChildren(
				sourceChildId,
				targetChildId,
				tenantId,
			);
			byTargetChild[targetChildId] = copied.length;
			totalCopied += copied.length;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push({ targetChildId, message: msg });
			logger.error('[child-challenge-copy-service] target child へのコピーに失敗', {
				context: { tenantId, sourceChildId, targetChildId, error: msg },
			});
		}
	}

	logger.info('[child-challenge-copy-service] 兄弟へのコピー完了', {
		context: {
			tenantId,
			sourceChildId,
			targetCount: targets.length,
			totalCopied,
			errorCount: errors.length,
		},
	});

	return { totalCopied, byTargetChild, errors };
}

export async function copyChildChallengesToSibling(
	tenantId: string,
	sourceChildId: number,
	targetChildId: number,
): Promise<ChildChallenge[]> {
	if (sourceChildId === targetChildId) {
		throw new Error('[child-challenge-copy-service] sourceChildId と targetChildId が同一です');
	}
	const repos = getRepos();
	return repos.childChallenge.copyAcrossChildren(sourceChildId, targetChildId, tenantId);
}
