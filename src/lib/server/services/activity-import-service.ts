import type { CategoryId, ChildId } from '$lib/domain/ids';
import { asCategoryId } from '$lib/domain/ids';
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
//   parallel write (family master + per-child instance) を停止。per-child bulk 配信のみ。
//   旧 activities table への write はゼロ。
// #4692 (2026-08-20): childIds 未指定時の「tenant 最初の child に bind」silent fallback を撤去。
//   取込先未指定なら ActivityImportTargetRequiredError を投げ、呼び出し側に明示を強制する。
// #2558 (2026-05-28): dedup scope を tenant 全体から child 単位に修正。
//   activity は ADR-0055 で per-child instance scope (data-model-resource-scope.md §3)。
//   旧実装は `findActivities(tenantId)` (tenant aggregate) で名前重複を見ていたため、
//   1 人目に取込済のパックを 2 人目に取込むと全 skip → imported:0 となり、UI 上
//   「追加を押しても無反応」(顧客クレーム) を生んでいた (#2458-A1 facade rewrite で混入)。
//   修正後は child ごとに既存 activity 名 Set を構築し、「その child に未存在のときだけ
//   その child へ instance を追加」する。imported は「いずれかの child に新規 instance を
//   生んだ activity 数」、skipped は「全 target child で既存だった activity 数」。

import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { ACTIVITY_SOURCES, PARENT_CREATED_SOURCE } from '$lib/domain/activity-source';
import { toLegacyCategoryId } from '$lib/domain/categories';
import type { ImportBlocked } from '$lib/marketplace/types';
import { findActivities } from '$lib/server/db/activity-repo';
import { getRepos } from '$lib/server/db/factory';
import type { InsertChildActivityInput } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import {
	type ActivityQuotaArchiveOutcome,
	archiveActivityQuotaOverflow,
	enforceActivityQuota,
	recordActivityQuotaArchiveMarker,
} from './activity-quota';

/** categoryCode (未検証文字列) → branded CategoryId (#3607: SSOT 派生、旧 index-based map を撤去) */
function categoryIdFromCode(code: string): CategoryId | undefined {
	const legacyId = toLegacyCategoryId(code);
	return legacyId === undefined ? undefined : asCategoryId(legacyId);
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
	/**
	 * #2830: 実際に persist 失敗した activity 数 (= 計画した新規 - 実 persist)。
	 *   `errors.length` は per-child catch 行 + 集計行が混在するため失敗 activity 数と
	 *   一致しない (bulk throw 1 回で 30 activity 喪失でも errors.length≈2)。UI の
	 *   partial-failure 件数表示は本フィールドを使う。
	 */
	failed: number;
	/**
	 * #4693: プラン上限で **意図的に取込対象から外した**分と、その顧客向け理由。
	 *   旧実装は理由を `errors` (表示ログ) にだけ push しており、UI がそれを読まないため
	 *   上限で全件弾かれても「0 件を復元しました」と成功トーンで出ていた。顧客に見せる
	 *   channel を別フィールドにして、`resolveImportFeedback` が 1 箇所で表示を決める。
	 */
	blocked?: ImportBlocked;
	/**
	 * #4693 (QM 再レビュー): **復元** (presetId 無し = `?/importFile` / `api/v1/activities/import`)
	 * がプラン上限で保管 (archived) した分。捨てていないので `blocked` とは別物で、
	 * 「入った数 / 保管した数 / 理由 / 次の行動」を顧客に出すための channel。
	 */
	activityQuota?: ActivityQuotaArchiveOutcome;
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
 * @property childIds #2362 PR-3 (ADR-0055): per-child instance への配信先 (#4692 で必須化)。
 *                    指定された各 child の `child_activities` に 1 instance ずつ複製する。
 *                    空配列は `ActivityImportTargetRequiredError` (silent fallback 廃止)。
 */
export interface ImportActivitiesOptions {
	presetId?: string;
	applyMustDefault?: boolean;
	/** #4692: 取込先は呼び出し側の必須責務 (型で省略できない形にする) */
	childIds: readonly ChildId[];
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
 * @param options    childIds（配信先 child、#4692 で必須）/ presetId（preset_duplicate 検知）/
 *                   applyMustDefault（must 推奨採用）。
 *                   旧 `string` (presetId 単独) 形式は childIds を表現できないため #4692 で撤去。
 */

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
	categoryId?: CategoryId;
	priority?: 'must' | 'optional';
} {
	const categoryId = categoryIdFromCode(a.categoryCode);
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
	childIds: readonly ChildId[],
	tenantId: string,
	errors: string[],
): Promise<Map<ChildId, Set<string>>> {
	const repos = getRepos();
	const byChild = new Map<ChildId, Set<string>>();
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
	inputsByChild: Map<ChildId, InsertChildActivityInput[]>,
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
 *
 * #2830: `failed` (= 計画した新規 - 実 persist) も合わせて返す。`errors.length` は
 *   per-child catch 行 + 集計行が混在し失敗 activity 数と乖離するため、UI 件数表示用の
 *   honest な失敗数を別途算出する。
 */
async function persistAndCountImported(
	childIds: readonly ChildId[],
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
	tenantId: string,
	errors: string[],
): Promise<{ imported: number; failed: number }> {
	if (childIds.length === 0) return { imported: 0, failed: 0 };
	const persistedNames = await dispatchPerChildBulk(childInputsByChild, tenantId, errors);
	let imported = 0;
	for (const name of plannedNewNames) {
		if (persistedNames.has(name)) imported++;
	}
	const failed = plannedNewNames.size - imported;
	if (failed > 0) {
		errors.push(`${failed} 件の活動を保存できませんでした`);
	}
	return { imported, failed };
}

/**
 * #4692: 取込先 child が 1 件も指定されていないときに投げるエラー。
 *
 * 旧実装は「tenant 最初の child に bind する」silent fallback を持っていたため、
 * けんたのタブで「バックアップから復元」を押すと 94 件がたろう (最初の子) に入り、
 * 操作した親から見ると「どこにも増えていない / 別の子が汚れた」状態になっていた。
 * 取込先は呼び出し側が必ず明示する (ADR-0055 per-child 主軸 / cross-child 誤配信の構造的排除)。
 */
export class ActivityImportTargetRequiredError extends Error {
	constructor() {
		super('取込先のお子さまが指定されていません');
		this.name = 'ActivityImportTargetRequiredError';
	}
}

/** planActivityForChildren の per-import 共通コンテキスト (param 数削減のため集約)。 */
interface PlanContext {
	presetId: string | undefined;
	childIds: readonly ChildId[];
	existingNamesByChild: Map<ChildId, Set<string>>;
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>;
}

/**
 * 1 activity を全 target child の per-child input に展開する (child 単位 dedup)。
 * @returns その activity がいずれかの child に「新規計画」されたか
 */
function planActivityForChildren(
	a: ActivityPackItem,
	categoryId: CategoryId,
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
			// #4693 (QM): 取込の作成経路を quota の母集団と一致させる。
			//
			// `presetId` の有無が「配布物か、その家庭が自分で足したものか」の唯一の判別子:
			//   - あり = marketplace プリセット取込 → `seed` (activity-source.ts の方針どおり quota 非対象)
			//   - なし = ファイル復元 (`?/importFile`) / `api/v1/activities/import`
			//            → 親が自分で用意した内容なので `custom` (手動作成と同じ扱い = quota 対象)
			//
			// 旧実装は source を渡さず repo 既定 `seed` に落ちていた。その状態で
			// `enforceActivityQuota` が全取込を custom quota で判定していたため、
			//   (a) 取込行が current を増やさず、3 件ずつ繰り返せば上限を超えて入る
			//   (b) 手動 3 件で上限に達した無料世帯は、自分のバックアップ復元まで恒久的に拒否される
			// の両方が起きていた (#4693 QM レビュー)。
			source: ctx.presetId ? ACTIVITY_SOURCES.seed.value : PARENT_CREATED_SOURCE,
			priority,
		});
		plannedForAnyChild = true;
	}
	return plannedForAnyChild;
}

/**
 * 取込 / 復元に quota を適用する (#4693 QM 再レビュー)。
 *
 * 適用方式は「配布物の取込」か「その家庭のデータの復元」かで分ける:
 *   - プリセット取込 (`presetId` あり) → `seed` 行なので quota 対象 0 行。drop 方式のまま
 *     (判定不能時は中止 = 再試行すれば済む、無害な倒し方)
 *   - 復元 (`presetId` なし = 活動管理の ︙ →「バックアップから復元」/ `api/v1/activities/import`
 *     の merge) → `custom` 行。**超過分は捨てずに保管**する。ここを drop のままにすると、
 *     settings > データ の ZIP/JSON 復元 (保管) と同じ状況で入口によって顧客のデータが片方だけ
 *     消える (PO 回答 2026-09-03 #2 を復元 4 経路すべてに適用する)
 *
 * 返す 2 つは意味が違う channel: `blocked` = 捨てた / `activityQuota` = 保管した。
 * どちらも `errors` (per-child catch 行 / 集計行が混ざる内部ログ) とは別に持つ — errors を
 * 顧客に見せると内部例外文字列が出る (ADR-0062)。
 */
async function applyImportQuota(
	isRestore: boolean,
	tenantId: string,
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
): Promise<{ blocked?: ImportBlocked; activityQuota?: ActivityQuotaArchiveOutcome }> {
	if (isRestore) {
		const outcome = await archiveActivityQuotaOverflow(
			tenantId,
			childInputsByChild,
			plannedNewNames,
		);
		// `message` が空 = 上限に触れていない。成功表示を汚さないため何も返さない。
		return { activityQuota: outcome.message === '' ? undefined : outcome };
	}
	const quota = await enforceActivityQuota(tenantId, childInputsByChild, plannedNewNames);
	return {
		blocked:
			quota.rejectedRows > 0
				? { count: quota.rejectedRows, message: quota.message, upgradeUrl: quota.upgradeUrl }
				: undefined,
	};
}

export async function importActivities(
	activities: ActivityPackItem[],
	tenantId: string,
	options: ImportActivitiesOptions,
): Promise<ActivityImportResult> {
	const opts = options;
	const { presetId } = opts;
	// #4692: 取込先 child は呼び出し側の必須責務。first-child silent fallback は廃止した。
	const childIds: readonly ChildId[] = opts.childIds ?? [];
	if (childIds.length === 0) {
		throw new ActivityImportTargetRequiredError();
	}
	const applyMustDefault = opts.applyMustDefault === true;

	const errors: string[] = [];
	let skipped = 0;

	// #2558: dedup を child 単位で行う (ADR-0055 per-child instance scope)。
	// 各 target child の既存 activity 名 Set を事前構築し、その child に未存在の場合のみ
	// instance を追加する。tenant 全体 dedup (旧実装) は別の子への取込を全 skip させ、
	// imported:0 → 「追加を押しても無反応」の顧客クレームを生んでいた。
	const existingNamesByChild = await buildExistingNamesByChild(childIds, tenantId, errors);

	// #2362 PR-3 (ADR-0055): per-child instance バッチ。
	const childInputsByChild: Map<ChildId, InsertChildActivityInput[]> = new Map();
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
			meta.categoryId as CategoryId,
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

	// #4693: **quota はここで一元強制する。** 経路ごとに `checkActivityLimit` を書く形では、
	// 経路が増えるたびに書き忘れが起きる (手動 / 一括 / コピー / テンプレ取込には gate があり、
	// ファイル復元だけ無かった = 無料プランが CSV を作れば無制限に増やせた、#4693 実測。
	// #2894 / #3740 に続く 3 件目)。`dispatchImport` 経由の取込 (marketplace 取込 / ファイル復元 /
	// api/v1 の merge 取込) は全て本関数を通るため、ここで切れば取込側は経路を足しても素通りしない。
	// 覆う経路と覆わない経路の境界は activity-quota.ts の冒頭コメントが SSOT。
	// 回帰 lock: tests/unit/services/activity-quota-import-enforcement.test.ts (取込経路の上限)
	// / tests/unit/routes/activities-quota-residual-gate.test.ts (本関数を通らない producer 経路)。
	// #4693 (QM 再レビュー): **同じ「バックアップから復元」なのに入口で結果が変わる**のを止める。
	//
	// `presetId` の有無がそのまま「配布物の取込」と「その家庭のデータの復元」の境界:
	//   - あり = marketplace プリセット取込 → `seed` 行 → quota 対象 0 行。従来どおり drop 方式
	//     (`enforceActivityQuota`)。判定不能時は中止 = 再試行すれば済む、無害な倒し方
	//   - なし = **復元** (活動管理の ︙ →「バックアップから復元」= `?/importFile` /
	//     `api/v1/activities/import` の merge) → `custom` 行。ここを drop のままにすると、
	//     settings > データ の ZIP/JSON 復元 (archive 方式) と同じ状況で顧客のデータが片方だけ
	//     消える。PO 回答 (2026-09-03) #2「超過分は捨てずに archived」を **復元 4 経路すべて**に適用する
	const { blocked, activityQuota } = await applyImportQuota(
		!presetId,
		tenantId,
		childInputsByChild,
		plannedNewNames,
	);

	// #2824 (取込永続 honesty): imported は「実際に DB に persist できた activity 数」。
	//   write を行わずに plannedNewNames.size を返すと、persist が全失敗 (本番 DynamoDB
	//   stub / 容量超過 等) でも UI が「N 件登録しました」と偽る。dispatchPerChildBulk が
	//   返す persist 成功名のみを imported に算入し、計画したのに persist できなかった分は
	//   errors として可視化する。これにより「偽の成功件数」を構造的に出さない。
	const { imported, failed } = await persistAndCountImported(
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
			failed,
			errors: errors.length,
			blocked: blocked?.count ?? 0,
			presetId: presetId ?? null,
			applyMustDefault,
			childIdsCount: childIds.length,
		},
	});

	// #4693 (QM 再レビュー): 保管した分の耐久記録を残す (行の `archived_reason` では
	// 「親が自分で選んだ保管」と区別できないため)。実書き込みのあとに呼ぶ。
	if (activityQuota) await recordActivityQuotaArchiveMarker(tenantId, activityQuota);

	return { imported, skipped, errors, failed, blocked, activityQuota };
}
