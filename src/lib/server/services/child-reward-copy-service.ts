import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/child-reward-copy-service.ts
// 兄弟共通化 UX (#2362 PR-4、ADR-0055、User §3 reward use case R6)
//
// source child の special_rewards を target children (配列) に複製作成する
// 専用 Service。SRP に従い「per-child instance の cross-child copy」のみを責務とする。
//
// 取込時の per-child 配信 (reward-set Strategy 経由) は
// reward-set-import-service → insertSpecialReward が担う。
// 本 Service は既に作成済の reward (ごほうび) の「兄弟への波及」UI から呼ばれる:
//
//   1. 「他の子供から copy」action: source → target 1 名 (UI 同期 / 過去 reward の取り込み)
//   2. 「全員に同期」action: source → 他兄弟全員 (新規 child 追加後の一括展開)
//
// PR-3 の `child-activity-copy-service.ts` と同型 (兄弟 / バルク pattern を踏襲)。
//
// 関連:
//   - docs/decisions/0055-per-child-primary-data-model-pattern.md
//   - docs/design/data-model-resource-scope.md §4.3 (reward exchange = per-child instance)
//   - src/lib/server/db/special-reward-repo.ts (findSpecialRewards / insertSpecialReward)

import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';
import { logger } from '$lib/server/logger';

export interface CopyChildRewardsContext {
	/** テナント ID (必須、tenant isolation 強制) */
	tenantId: string;
	/** コピー元 child */
	sourceChildId: ChildId;
	/** コピー先 child 配列 (1 件 = 1 child へ複製、複数指定で全員に同時複製) */
	targetChildIds: readonly ChildId[];
}

export interface CopyChildRewardsResult {
	/** 各 target child に作成された SpecialReward 件数の合計 */
	totalCopied: number;
	/** #4694: target に同じ title が既にあり skip した件数の合計 */
	totalSkipped: number;
	/** target child 別のコピー件数 (UI feedback 用) */
	byTargetChild: Record<string, number>;
	/** #4694: target child 別の skip 件数 (UI feedback 用) */
	skippedByTargetChild: Record<string, number>;
	/** 個別エラー (target child 単位、tenant 違反 / 親が存在しない等) */
	errors: { targetChildId: ChildId; message: string }[];
}

/**
 * source child の special_rewards 全件を、複数 target children に複製する。
 *
 * 各 target 単位で findSpecialRewards 後、insertSpecialReward を順次呼び出す。
 * 同一 title が既に target child に存在する場合は skip (重複防止)。
 * 1 target child が失敗しても他は継続する (partial success 許容)。
 *
 * @param ctx tenantId / sourceChildId / targetChildIds
 * @returns 合計件数 + target 別件数 + 個別エラー
 */
export async function copyChildRewardsToSiblings(
	ctx: CopyChildRewardsContext,
): Promise<CopyChildRewardsResult> {
	const { tenantId, sourceChildId, targetChildIds } = ctx;

	const byTargetChild: Record<string, number> = {};
	const skippedByTargetChild: Record<string, number> = {};
	const errors: { targetChildId: ChildId; message: string }[] = [];
	let totalCopied = 0;
	let totalSkipped = 0;

	// 同一 child への self-copy は明示的に拒否 (誤操作防止)
	const targets = targetChildIds.filter((id) => id !== sourceChildId);
	if (targets.length !== targetChildIds.length) {
		logger.warn(
			'[child-reward-copy-service] self-copy を除外 (sourceChildId と同一の targetChildId)',
			{
				context: { tenantId, sourceChildId, originalTargetCount: targetChildIds.length },
			},
		);
	}

	// source の全 reward を取得 (1 回のみ、target 数に関係なく再利用)
	const sourceRewards = await findSpecialRewards(sourceChildId, tenantId);
	if (sourceRewards.length === 0) {
		logger.info('[child-reward-copy-service] コピー元に reward が存在しないため skip', {
			context: { tenantId, sourceChildId },
		});
		return {
			totalCopied: 0,
			totalSkipped: 0,
			byTargetChild: {},
			skippedByTargetChild: {},
			errors: [],
		};
	}

	for (const targetChildId of targets) {
		try {
			// target child の既存 reward title 集合を取得 (重複検知用)
			const existing = await findSpecialRewards(targetChildId, tenantId);
			const existingTitles = new Set(existing.map((r) => r.title));
			let copiedForTarget = 0;
			// #4694: skip 件数も返して「N 件コピー / M 件は既にあるためスキップ」を UI に出す。
			let skippedForTarget = 0;
			for (const r of sourceRewards) {
				if (existingTitles.has(r.title)) {
					skippedForTarget++;
					continue;
				}
				await insertSpecialReward(
					{
						childId: targetChildId,
						grantedBy: null,
						title: r.title,
						description: r.description ?? undefined,
						points: r.points,
						icon: r.icon ?? undefined,
						category: r.category,
						// source の sourcePresetId はリネージとして引き継ぐ (取込重複検知互換)
						sourcePresetId: r.sourcePresetId,
						// #3147: ショップ陳列系統も兄弟間で引き継ぐ (null は表示側 fallback)
						shopCategory: r.shopCategory ?? null,
					},
					tenantId,
				);
				existingTitles.add(r.title);
				copiedForTarget++;
			}
			byTargetChild[targetChildId] = copiedForTarget;
			skippedByTargetChild[targetChildId] = skippedForTarget;
			totalCopied += copiedForTarget;
			totalSkipped += skippedForTarget;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push({ targetChildId, message: msg });
			logger.error('[child-reward-copy-service] target child へのコピーに失敗', {
				context: { tenantId, sourceChildId, targetChildId, error: msg },
			});
		}
	}

	logger.info('[child-reward-copy-service] 兄弟へのコピー完了', {
		context: {
			tenantId,
			sourceChildId,
			targetCount: targets.length,
			totalCopied,
			totalSkipped,
			errorCount: errors.length,
		},
	});

	return { totalCopied, totalSkipped, byTargetChild, skippedByTargetChild, errors };
}

/**
 * 単一 target に対する copy。`copyChildRewardsToSiblings` の 1 件版 (UI 簡易 wrapper)。
 *
 * @returns コピーした件数と、重複 (同 title) で skip した件数 (#4694)
 * @throws Error - tenant 違反 / target child が存在しない / self-copy 等の検証失敗時
 */
export async function copyChildRewardsToSibling(
	tenantId: string,
	sourceChildId: ChildId,
	targetChildId: ChildId,
): Promise<{ copied: number; skipped: number }> {
	if (sourceChildId === targetChildId) {
		throw new Error('同じお子さまにはコピーできません');
	}
	const result = await copyChildRewardsToSiblings({
		tenantId,
		sourceChildId,
		targetChildIds: [targetChildId],
	});
	if (result.errors.length > 0) {
		const first = result.errors[0];
		throw new Error(first?.message ?? 'コピーに失敗しました');
	}
	return { copied: result.totalCopied, skipped: result.totalSkipped };
}
