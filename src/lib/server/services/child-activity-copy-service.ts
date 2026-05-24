// src/lib/server/services/child-activity-copy-service.ts
// 兄弟共通化 UX (#2362 PR-3、ADR-0055、User §1)
//
// source child の child_activities を target children (配列) に複製作成する
// 専用 Service。SRP に従い「per-child instance の cross-child copy」のみを責務とする。
//
// 取込時の per-child 配信 (`requiresChildSelection: true` 経由) は
// activity-pack-strategy → IChildActivityRepo.insertActivitiesBulk が担う。
// 本 Service は既に作成済の活動の「兄弟への波及」UI から呼ばれる:
//
//   1. 「他の子供から copy」action: source → target 1 名 (UI 同期 / 過去活動の取り込み)
//   2. 「全員に同期」action: source → 他兄弟全員 (新規 child 追加後の一括展開)
//
// 関連:
//   - docs/decisions/0055-per-child-primary-data-model-pattern.md
//   - docs/design/data-model-resource-scope.md §4.1 (per-child instance 設計)
//   - src/lib/server/db/sqlite/child-activity-repo.ts (copyActivitiesAcrossChildren)
//   - src/lib/server/db/interfaces/child-activity-repo.interface.ts

import { getRepos } from '$lib/server/db/factory';
import type { ChildActivity } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

export interface CopyChildActivitiesContext {
	/** テナント ID (必須、tenant isolation 強制) */
	tenantId: string;
	/** コピー元 child */
	sourceChildId: number;
	/** コピー先 child 配列 (1 件 = 1 child へ複製、複数指定で全員に同時複製) */
	targetChildIds: readonly number[];
}

export interface CopyChildActivitiesResult {
	/** 各 target child に作成された ChildActivity 件数の合計 */
	totalCopied: number;
	/** target child 別のコピー件数 (UI feedback 用) */
	byTargetChild: Record<number, number>;
	/** 個別エラー (target child 単位、tenant 違反 / 親が存在しない等) */
	errors: { targetChildId: number; message: string }[];
}

/**
 * source child の activity 全件を、複数 target children に複製する。
 *
 * 同一 PR 内で IChildActivityRepo.copyActivitiesAcrossChildren を target 数だけ呼び出す。
 * 各 target は独立に処理し、1 件失敗しても他は継続する (partial success 許容)。
 *
 * @param ctx tenantId / sourceChildId / targetChildIds
 * @returns 合計件数 + target 別件数 + 個別エラー
 */
export async function copyChildActivitiesToSiblings(
	ctx: CopyChildActivitiesContext,
): Promise<CopyChildActivitiesResult> {
	const { tenantId, sourceChildId, targetChildIds } = ctx;
	const repos = getRepos();

	const byTargetChild: Record<number, number> = {};
	const errors: { targetChildId: number; message: string }[] = [];
	let totalCopied = 0;

	// 同一 child への self-copy は明示的に拒否 (誤操作防止)
	const targets = targetChildIds.filter((id) => id !== sourceChildId);
	if (targets.length !== targetChildIds.length) {
		logger.warn(
			'[child-activity-copy-service] self-copy を除外 (sourceChildId と同一の targetChildId)',
			{
				context: { tenantId, sourceChildId, originalTargetCount: targetChildIds.length },
			},
		);
	}

	for (const targetChildId of targets) {
		try {
			const copied = await repos.childActivity.copyActivitiesAcrossChildren(
				sourceChildId,
				targetChildId,
				tenantId,
			);
			byTargetChild[targetChildId] = copied.length;
			totalCopied += copied.length;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push({ targetChildId, message: msg });
			logger.error('[child-activity-copy-service] target child へのコピーに失敗', {
				context: { tenantId, sourceChildId, targetChildId, error: msg },
			});
		}
	}

	logger.info('[child-activity-copy-service] 兄弟へのコピー完了', {
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

/**
 * 単一 target child へのコピー (UI 単発 action 向け convenience)。
 *
 * @returns target child に作成された ChildActivity 配列
 */
export async function copyChildActivitiesToSibling(
	tenantId: string,
	sourceChildId: number,
	targetChildId: number,
): Promise<ChildActivity[]> {
	if (sourceChildId === targetChildId) {
		throw new Error('[child-activity-copy-service] sourceChildId と targetChildId が同一です');
	}
	const repos = getRepos();
	return repos.childActivity.copyActivitiesAcrossChildren(sourceChildId, targetChildId, tenantId);
}
