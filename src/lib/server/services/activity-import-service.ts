// src/lib/server/services/activity-import-service.ts
// 活動単体インポートサービス（#0224）
//
// @deprecated #2365 (ADR-0052): activity-pack を新 `ImportStrategy` 経由に移行。
//   本 service は `$lib/marketplace/strategies/activity-pack-strategy.ts` の内部実装として
//   並行稼働中だが、外部からの直接呼出は `+page.server.ts` 1 ヶ所のみに集約済 (Strangler Fig)。
//   1 release 経過後 (別 Issue) に撤去予定。新規 callsite を増やさないこと。
//
// #2362 PR-3 (ADR-0055): per-child instance への配信を `options.childIds` で受領可能化。
// #2458-A1 (2026-05-26): facade insertActivity が child_activities 経由に変更されたため、
//   parallel write (family master + per-child instance) を停止。childIds 未指定時は
//   facade 経由 (= tenant 最初の child に bind) のみ、指定時は per-child bulk 配信のみ。
//   旧 activities table への write はゼロ。
// #2558 (2026-05-28): dedup scope を tenant 全体から child 単位に修正。
//   activity は ADR-0055 で per-child instance scope (data-model-resource-scope.md §3)。
//   旧実装は `findActivities(tenantId)` (tenant aggregate) で名前重複を見ていたため、
//   1 人目に取込済のパックを 2 人目に取込むと全 skip → imported:0 となり、UI 上
//   「追加を押しても無反応」(顧客クレーム) を生んでいた (#2458-A1 facade rewrite で混入)。
//   修正後は child ごとに既存 activity 名 Set を構築し、「その child に未存在のときだけ
//   その child へ instance を追加」する。imported は「いずれかの child に新規 instance を
//   生んだ activity 数」、skipped は「全 target child で既存だった activity 数」。

import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { findActivities } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { getRepos } from '$lib/server/db/factory';
import type { InsertChildActivityInput } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

const CATEGORY_CODE_TO_ID: Record<string, number> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_CODE_TO_ID[code] = i + 1;
}

export interface ActivityImportPreview {
	total: number;
	newActivities: number;
	duplicates: number;
	duplicateNames: string[];
	byCategory: Record<string, number>;
}

export interface ActivityImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

/**
 * インポート対象の活動をプレビュー（実際にはDBに書き込まない）
 *
 * @deprecated #2365 (ADR-0052): activity-pack Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/activity-pack-strategy` 経由で本関数を呼び出し、
 *   戻り値は `ImportPreview` shape に正規化されます。1 release 経過後撤去予定。
 */
export async function previewActivityImport(
	activities: ActivityPackItem[],
	tenantId: string,
): Promise<ActivityImportPreview> {
	const existing = await findActivities(tenantId);
	const existingNames = new Set(existing.map((a) => a.name));

	const duplicateNames: string[] = [];
	const byCategory: Record<string, number> = {};
	let newCount = 0;

	for (const a of activities) {
		const catName = a.categoryCode;
		byCategory[catName] = (byCategory[catName] ?? 0) + 1;

		if (existingNames.has(a.name)) {
			duplicateNames.push(a.name);
		} else {
			newCount++;
		}
	}

	return {
		total: activities.length,
		newActivities: newCount,
		duplicates: duplicateNames.length,
		duplicateNames,
		byCategory,
	};
}

/**
 * 活動インポートのオプション
 *
 * @property presetId マーケットプレイスプリセット由来の場合、パックID
 *                    （#1254 G1: import 時の preset_duplicate 検知に利用）
 * @property applyMustDefault 親側 UI のチェックボックスが ON のとき true。
 *                            true の場合、`ActivityPackItem.mustDefault === true` の活動は
 *                            `priority='must'` でインポートされる（#1758 / #1709-D）。
 *                            false / 未指定の場合は全活動が `priority='optional'`。
 * @property childIds #2362 PR-3 (ADR-0055): per-child instance への配信先。
 *                    1 件以上指定された場合、family master insert に加え、
 *                    各 child の `child_activities` table にも 1 instance ずつ複製する。
 *                    未指定の場合は legacy 動作 (family master のみ insert) を維持。
 *                    Phase 6/7 で family master insert は drop し本フィールド必須化予定。
 */
export interface ImportActivitiesOptions {
	presetId?: string;
	applyMustDefault?: boolean;
	childIds?: readonly number[];
}

/**
 * 活動をインポート（mergeモード: 重複はスキップ）
 *
 * @deprecated #2365 (ADR-0052): activity-pack Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/activity-pack-strategy` が本関数を内部 callee として参照中。
 *   外部 callsite は `+page.server.ts` 1 ヶ所のみ (Strangler Fig)。1 release 経過後撤去予定。
 *
 * @param activities インポート対象の活動配列（marketplace activity-pack の payload.activities など）
 * @param tenantId   テナントID
 * @param options    presetId（preset_duplicate 検知）と applyMustDefault（must 推奨採用）
 *                   後方互換のため `string` を渡した場合は presetId として扱う。
 */
/**
 * options 正規化 (後方互換: string も presetId として受領)
 */
function normalizeOptions(options?: ImportActivitiesOptions | string): ImportActivitiesOptions {
	return typeof options === 'string' ? { presetId: options } : (options ?? {});
}

/**
 * 1 件分の activity の category 解決 + priority 判定を行う。
 * per-child dedup は呼び出し側 (`importActivities`) が child ごとの既存名 Set で行うため、
 * 本 helper では category 妥当性のみを判定する (#2558)。
 */
function resolveActivityMeta(
	a: ActivityPackItem,
	applyMustDefault: boolean,
): {
	ok: boolean;
	error?: string;
	categoryId?: number;
	priority?: 'must' | 'optional';
} {
	const categoryId = CATEGORY_CODE_TO_ID[a.categoryCode];
	if (!categoryId) {
		return {
			ok: false,
			error: `「${a.name}」: カテゴリ「${a.categoryCode}」が不明`,
		};
	}

	// #1758 (#1709-D): mustDefault が true かつ親側で ON のとき priority='must'。
	// それ以外（OFF / mustDefault undefined / false）は schema default の 'optional'。
	const priority: 'must' | 'optional' =
		applyMustDefault && a.mustDefault === true ? 'must' : 'optional';

	return { ok: true, categoryId, priority };
}

/**
 * #2558: child ごとの既存 activity 名 Set を構築する。
 * activity は per-child instance scope (ADR-0055) のため、dedup も child 単位で行う。
 * 各 child を `findActivitiesByChild` で読み、name を Set 化して返す。
 * read 失敗は空 Set にフォールバックし、import 自体は継続する (errors に記録)。
 */
async function buildExistingNamesByChild(
	childIds: readonly number[],
	tenantId: string,
	errors: string[],
): Promise<Map<number, Set<string>>> {
	const repos = getRepos();
	const byChild = new Map<number, Set<string>>();
	for (const cid of childIds) {
		try {
			const existing = await repos.childActivity.findActivitiesByChild(cid, tenantId, {
				includeArchived: true,
			});
			byChild.set(cid, new Set(existing.map((a) => a.name)));
		} catch (e) {
			errors.push(`[child=${cid}] 既存活動の読み取りに失敗: ${String(e)}`);
			byChild.set(cid, new Set());
		}
	}
	return byChild;
}

/**
 * per-child 配信 (#2362 PR-3): 各 child に instance を bulk insert。
 * child 単位で失敗しても他は継続 (partial success)。
 *
 * #2824 (取込永続 honesty): 「実際に persist できた activity 名」を集合として返す。
 *   旧実装は imported を write 前 (計画時) に確定していたため、insertActivitiesBulk が
 *   throw しても (本番 DynamoDB stub / 容量超過 / 権限不足 等) imported が減らず、UI が
 *   「N 件登録しました」と偽った。本 helper は persist 成功分の名前のみ報告し、呼び出し側で
 *   imported を実 persist 数から算出させることで「偽の成功件数」を構造的に防ぐ。
 *
 * @returns persist に成功した activity 名の集合 (どこか 1 child でも成功した名前を含む)
 */
async function dispatchPerChildBulk(
	inputsByChild: Map<number, InsertChildActivityInput[]>,
	tenantId: string,
	errors: string[],
): Promise<Set<string>> {
	const repos = getRepos();
	const persistedNames = new Set<string>();
	for (const [cid, inputs] of inputsByChild) {
		if (inputs.length === 0) continue;
		try {
			const created = await repos.childActivity.insertActivitiesBulk(inputs, tenantId);
			for (const a of created) persistedNames.add(a.name);
		} catch (e) {
			errors.push(`[child=${cid}] per-child instance 作成失敗: ${String(e)}`);
		}
	}
	return persistedNames;
}

/**
 * #2824: per-child bulk を実行し、実際に persist できた activity 数 (imported) を返す。
 * 計画したのに persist できなかった分 (DynamoDB stub / 容量超過 等) は errors に記録する。
 * child が 0 件のときは write を行わず imported=0 (honest)。
 */
async function persistAndCountImported(
	childIds: readonly number[],
	childInputsByChild: Map<number, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
	tenantId: string,
	errors: string[],
): Promise<number> {
	if (childIds.length === 0) return 0;
	const persistedNames = await dispatchPerChildBulk(childInputsByChild, tenantId, errors);
	let imported = 0;
	for (const name of plannedNewNames) {
		if (persistedNames.has(name)) imported++;
	}
	const failedToPersist = plannedNewNames.size - imported;
	if (failedToPersist > 0) {
		errors.push(`${failedToPersist} 件の活動を保存できませんでした`);
	}
	return imported;
}

/**
 * #2458-A1: childIds 未指定時の fallback bind helper。
 * 旧 path では family master `activities` table へ insert していたが、facade rewrite で
 * 旧 table への write が消えたため、per-child instance を必ず作成する必要がある。
 * tenant 最初の child に bind する。
 */
async function _fallbackChildIds(
	tenantId: string,
	current: readonly number[],
): Promise<readonly number[]> {
	if (current.length > 0) return current;
	const all = await findAllChildren(tenantId);
	if (all.length > 0 && all[0]) return [all[0].id];
	return [];
}

/** planActivityForChildren の per-import 共通コンテキスト (param 数削減のため集約)。 */
interface PlanContext {
	presetId: string | undefined;
	childIds: readonly number[];
	existingNamesByChild: Map<number, Set<string>>;
	childInputsByChild: Map<number, InsertChildActivityInput[]>;
}

/**
 * 1 activity を全 target child の per-child input に展開する (child 単位 dedup)。
 * @returns その activity がいずれかの child に「新規計画」されたか
 */
function planActivityForChildren(
	a: ActivityPackItem,
	categoryId: number,
	priority: 'must' | 'optional',
	ctx: PlanContext,
): boolean {
	let plannedForAnyChild = false;
	for (const cid of ctx.childIds) {
		const childNames = ctx.existingNamesByChild.get(cid);
		// 既存 + 同一 import 内での重複の両方を防ぐため Set を逐次更新する。
		if (childNames?.has(a.name)) continue;
		childNames?.add(a.name);
		ctx.childInputsByChild.get(cid)?.push({
			childId: cid,
			name: a.name,
			categoryId,
			icon: a.icon,
			basePoints: a.basePoints,
			triggerHint: a.triggerHint ?? null,
			sourcePresetId: ctx.presetId ?? null,
			priority,
		});
		plannedForAnyChild = true;
	}
	return plannedForAnyChild;
}

export async function importActivities(
	activities: ActivityPackItem[],
	tenantId: string,
	options?: ImportActivitiesOptions | string,
): Promise<ActivityImportResult> {
	const opts = normalizeOptions(options);
	const { presetId } = opts;
	const childIds: readonly number[] = await _fallbackChildIds(tenantId, opts.childIds ?? []);
	const applyMustDefault = opts.applyMustDefault === true;

	const errors: string[] = [];
	let skipped = 0;

	// #2558: dedup を child 単位で行う (ADR-0055 per-child instance scope)。
	// 各 target child の既存 activity 名 Set を事前構築し、その child に未存在の場合のみ
	// instance を追加する。tenant 全体 dedup (旧実装) は別の子への取込を全 skip させ、
	// imported:0 → 「追加を押しても無反応」の顧客クレームを生んでいた。
	const existingNamesByChild = await buildExistingNamesByChild(childIds, tenantId, errors);

	// #2362 PR-3 (ADR-0055): per-child instance バッチ。
	const childInputsByChild: Map<number, InsertChildActivityInput[]> = new Map();
	for (const cid of childIds) childInputsByChild.set(cid, []);

	// #2824: 「いずれかの child に新規 instance を生成しようと計画した」名前。
	//   imported は計画時ではなく実 persist 後に確定する (下記参照)。
	const plannedNewNames = new Set<string>();
	const planCtx: PlanContext = { presetId, childIds, existingNamesByChild, childInputsByChild };

	for (const a of activities) {
		const meta = resolveActivityMeta(a, applyMustDefault);
		if (!meta.ok) {
			if (meta.error) errors.push(meta.error);
			continue;
		}
		const planned = planActivityForChildren(
			a,
			meta.categoryId as number,
			meta.priority as 'must' | 'optional',
			planCtx,
		);
		if (planned) {
			plannedNewNames.add(a.name);
		} else {
			// 全 target child で既存だった (どこにも追加しない) activity。
			skipped++;
		}
	}

	// #2824 (取込永続 honesty): imported は「実際に DB に persist できた activity 数」。
	//   write を行わずに plannedNewNames.size を返すと、persist が全失敗 (本番 DynamoDB
	//   stub / 容量超過 等) でも UI が「N 件登録しました」と偽る。dispatchPerChildBulk が
	//   返す persist 成功名のみを imported に算入し、計画したのに persist できなかった分は
	//   errors として可視化する。これにより「偽の成功件数」を構造的に出さない。
	const imported = await persistAndCountImported(
		childIds,
		childInputsByChild,
		plannedNewNames,
		tenantId,
		errors,
	);

	logger.info('[activity-import] インポート完了', {
		context: {
			tenantId,
			imported,
			plannedNew: plannedNewNames.size,
			skipped,
			errors: errors.length,
			presetId: presetId ?? null,
			applyMustDefault,
			childIdsCount: childIds.length,
		},
	});

	return { imported, skipped, errors };
}
