import type { ChildId } from '$lib/domain/ids';
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
// #4694: 重複検知を本 service に置く (ごほうびの child-reward-copy-service と同型)。
//   旧実装は repo の `copyActivitiesAcrossChildren` を無条件に呼んでいたため、同じコピーを
//   2 回押すと同名・同カテゴリの活動が丸ごと二重登録された (43 件 → 86 件、無料プランでは
//   quota も二重消費)。target に同名 + 同カテゴリが既にあれば skip し、件数を呼出側へ返す。
//
// 関連:
//   - docs/decisions/0055-per-child-primary-data-model-pattern.md
//   - docs/design/data-model-resource-scope.md §4.1 (per-child instance 設計)
//   - src/lib/server/services/child-reward-copy-service.ts (同型の title 重複 skip)

import { getRepos } from '$lib/server/db/factory';
import type { ChildActivity, InsertChildActivityInput } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

export interface CopyChildActivitiesContext {
	/** テナント ID (必須、tenant isolation 強制) */
	tenantId: string;
	/** コピー元 child */
	sourceChildId: ChildId;
	/** コピー先 child 配列 (1 件 = 1 child へ複製、複数指定で全員に同時複製) */
	targetChildIds: readonly ChildId[];
}

export interface CopyChildActivitiesResult {
	/** 各 target child に作成された ChildActivity 件数の合計 */
	totalCopied: number;
	/** #4694: target に同名 + 同カテゴリが既にあり skip した件数の合計 */
	totalSkipped: number;
	/** target child 別のコピー件数 (UI feedback 用) */
	byTargetChild: Record<string, number>;
	/** #4694: target child 別の skip 件数 (UI feedback 用) */
	skippedByTargetChild: Record<string, number>;
	/** 個別エラー (target child 単位、tenant 違反 / 親が存在しない等) */
	errors: { targetChildId: ChildId; message: string }[];
}

/**
 * #4694: 重複判定キー。同じ子の中で「同じ名前 + 同じカテゴリ」の活動は同一とみなす。
 * 名前だけだと、カテゴリ違いの同名活動 (例: べんきょうの「よみもの」/ そうぞうの「よみもの」)
 * を取りこぼすため、カテゴリまで含めて判定する。
 */
function duplicateKey(a: { name: string; categoryId: number | string }): string {
	return `${a.categoryId}::${a.name}`;
}

/** copy 対象 activity を target child 用の insert input に写像する (sqlite / dsql 共通の subset)。 */
function toCopyInput(a: ChildActivity, targetChildId: ChildId): InsertChildActivityInput {
	return {
		childId: targetChildId,
		name: a.name,
		categoryId: a.categoryId,
		icon: a.icon,
		basePoints: a.basePoints,
		triggerHint: a.triggerHint,
		isMainQuest: a.isMainQuest,
		sourcePresetId: a.sourcePresetId,
		priority: a.priority,
		// #3669: 元活動の source を保全 (custom の copy は custom のまま quota に数える。
		// copy 経由の quota 迂回と provenance 喪失を防ぐ)
		source: a.source,
	};
}

/**
 * source child の activity 全件を、複数 target children に複製する。
 *
 * 各 target は独立に処理し、1 件失敗しても他は継続する (partial success 許容)。
 * target に同名 + 同カテゴリの活動が既にあれば skip する (#4694、冪等)。
 *
 * @param ctx tenantId / sourceChildId / targetChildIds
 * @returns 合計件数 (コピー / skip) + target 別件数 + 個別エラー
 */
export async function copyChildActivitiesToSiblings(
	ctx: CopyChildActivitiesContext,
): Promise<CopyChildActivitiesResult> {
	const { tenantId, sourceChildId, targetChildIds } = ctx;
	const repos = getRepos();

	const byTargetChild: Record<string, number> = {};
	const skippedByTargetChild: Record<string, number> = {};
	const errors: { targetChildId: ChildId; message: string }[] = [];
	let totalCopied = 0;
	let totalSkipped = 0;

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

	// source の全 activity を取得 (1 回のみ、target 数に関係なく再利用)。
	// 非表示 (visible=0) の活動も兄弟に引き継ぐため visibleOnly=false。
	const sourceActivities = await repos.childActivity.findActivitiesByChild(
		sourceChildId,
		tenantId,
		{ includeArchived: false, visibleOnly: false },
	);
	if (sourceActivities.length === 0) {
		logger.info('[child-activity-copy-service] コピー元に activity が存在しないため skip', {
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
			// #4694: target の既存 (name + categoryId) 集合で重複を弾く。
			const existing = await repos.childActivity.findActivitiesByChild(targetChildId, tenantId, {
				includeArchived: false,
				visibleOnly: false,
			});
			const existingKeys = new Set(existing.map(duplicateKey));

			const inputs: InsertChildActivityInput[] = [];
			let skippedForTarget = 0;
			for (const a of sourceActivities) {
				const key = duplicateKey(a);
				// source 内に同名 + 同カテゴリが複数あっても target には 1 件だけ作る
				if (existingKeys.has(key)) {
					skippedForTarget++;
					continue;
				}
				existingKeys.add(key);
				inputs.push(toCopyInput(a, targetChildId));
			}

			const created =
				inputs.length > 0 ? await repos.childActivity.insertActivitiesBulk(inputs, tenantId) : [];
			byTargetChild[targetChildId] = created.length;
			skippedByTargetChild[targetChildId] = skippedForTarget;
			totalCopied += created.length;
			totalSkipped += skippedForTarget;
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
			totalSkipped,
			errorCount: errors.length,
		},
	});

	return { totalCopied, totalSkipped, byTargetChild, skippedByTargetChild, errors };
}

/**
 * 単一 target child へのコピー (UI 単発 action 向け convenience)。
 *
 * @returns コピーした件数と、重複で skip した件数 (#4694)
 */
export async function copyChildActivitiesToSibling(
	tenantId: string,
	sourceChildId: ChildId,
	targetChildId: ChildId,
): Promise<{ copied: number; skipped: number }> {
	if (sourceChildId === targetChildId) {
		throw new Error('[child-activity-copy-service] sourceChildId と targetChildId が同一です');
	}
	const result = await copyChildActivitiesToSiblings({
		tenantId,
		sourceChildId,
		targetChildIds: [targetChildId],
	});
	const firstError = result.errors[0];
	if (firstError) {
		throw new Error(firstError.message);
	}
	return { copied: result.totalCopied, skipped: result.totalSkipped };
}
