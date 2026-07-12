import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/reward-set-import-service.ts
// マーケットプレイス reward-set 一括取込サービス (#2136 MP-1)
//
// activity-import-service.ts を template として横展開した実装。
// `special_rewards.sourcePresetId` カラム (#1254 G1) を流用し、
// preset_duplicate を検知して同一 preset の二重取込を防ぐ。
//
// 違いの要点:
// - reward-set は子供毎に紐付くため、対象子供を必須引数として受け取る
// - 既存判定キーは「同一 sourcePresetId + 同一 title」の組（title だけだと
//   ユーザーが手動で同名 reward を作っていた場合に誤検知するため）
// - activity と異なり「カテゴリ ID マッピング」は不要（reward-set の category は
//   そのまま `special_rewards.category` に書き込む）
//
// @deprecated #2366 (ADR-0052): reward-set を新 `ImportStrategy` 経由に移行。
//   本 service は `$lib/marketplace/strategies/reward-set-strategy.ts` の内部実装として
//   並行稼働中だが、外部からの直接呼出は Strategy 内部 callee のみに集約済 (Strangler Fig)。
//   1 release 経過後 (別 Issue) に撤去予定。新規 callsite を増やさないこと。

import type { RewardSetPayload } from '$lib/domain/marketplace-item';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';
import { logger } from '$lib/server/logger';

// ---------- 型定義 ----------

/** RewardSetPayload['rewards'] の 1 件 */
export type RewardSetItem = RewardSetPayload['rewards'][number];

export interface RewardSetImportPreview {
	/** preset 内に含まれるごほうび総数 */
	total: number;
	/** 新規追加されるごほうび数（重複を除く） */
	newRewards: number;
	/** 既に取込済の重複ごほうび数 */
	duplicates: number;
	/** 重複ごほうびのタイトル一覧（UI 表示用） */
	duplicateTitles: string[];
}

export interface RewardSetImportResult {
	/** 実際に DB に挿入された件数 */
	imported: number;
	/** 重複でスキップされた件数 */
	skipped: number;
	/** 個別失敗のエラー（DB 例外など） */
	errors: string[];
	/**
	 * #2830: 実際に persist 失敗した reward 件数。reward-set は per-reward try/catch のため
	 *   `errors.length` と一致するが、5 type 横断で UI が一貫して `failed` を参照できるよう
	 *   明示的に算出して返す (AC4 横展開、ImportResult 契約整合)。
	 */
	failed: number;
}

/**
 * 重複検知モード (#3168)。
 * - `'preset-scope'` (既定、#1254 G1): 「同一 sourcePresetId + 同一 title」のみ重複扱い。
 *   marketplace preset 取込で、ユーザーが手動作成した同名 reward (sourcePresetId=NULL) を
 *   clobber しないための意図的 scope。
 * - `'content'` (#3168 backup/restore): sourcePresetId 非依存で「同一 title + 同一 points」を
 *   全既存 reward と照合して重複扱い。populated tenant へ自分のバックアップを復元しても二重化
 *   しない (restore 冪等性)。restore 専用で、preset 取込は `'preset-scope'` のまま。
 */
export type RewardDedupMode = 'preset-scope' | 'content';

/** (title, points) を結合した content 重複キー。区切りに NUL を使い title 内の偶発衝突を避ける。 */
function rewardContentKey(title: string, points: number): string {
	return `${title}\0${points}`;
}

/**
 * 既存 reward 群から「取込候補 reward が重複か」を判定する matcher を構築する (#3168)。
 * dedupMode で preset-scope (#1254 G1) / content (restore 冪等) を切り替える。
 */
interface RewardDuplicateMatcher {
	/** 取込候補 reward が (既存 or 同一バッチ内で既取込) 重複か */
	isDuplicate(reward: { title: string; points: number }): boolean;
	/** import で実 INSERT した reward を「既取込」として登録 (同一バッチ内の重複 title も skip するため) */
	markImported(reward: { title: string; points: number }): void;
}

function buildRewardDuplicateMatcher(
	existing: ReadonlyArray<{ title: string; points: number; sourcePresetId?: string | null }>,
	presetId: string,
	dedupMode: RewardDedupMode,
): RewardDuplicateMatcher {
	if (dedupMode === 'content') {
		// #3168: sourcePresetId 非依存で (title+points) 照合 = restore 冪等。
		const keys = new Set(existing.map((r) => rewardContentKey(r.title, r.points)));
		return {
			isDuplicate: (reward) => keys.has(rewardContentKey(reward.title, reward.points)),
			markImported: (reward) => {
				keys.add(rewardContentKey(reward.title, reward.points));
			},
		};
	}
	// 既定 (preset-scope, #1254 G1): 同一 sourcePresetId + 同一 title のみ重複。
	const sameSourceTitles = new Set(
		existing.filter((r) => r.sourcePresetId === presetId).map((r) => r.title),
	);
	return {
		isDuplicate: (reward) => sameSourceTitles.has(reward.title),
		markImported: (reward) => {
			sameSourceTitles.add(reward.title);
		},
	};
}

export interface ImportRewardSetOptions {
	/**
	 * マーケットプレイスのプリセット ID（例: `kinder-rewards`）。
	 * `special_rewards.sourcePresetId` に書き込まれ、
	 * 次回 import 時の重複検知に使用される。
	 */
	presetId: string;
	/**
	 * 適用対象の子供 ID。reward-set は子供毎に付与するため必須。
	 */
	childId: ChildId;
	/**
	 * 重複検知モード (#3168)。省略時は `'preset-scope'` (既定、#1254 G1)。
	 * backup/restore は `'content'` を渡して冪等復元する。
	 */
	dedupMode?: RewardDedupMode;
}

/**
 * 複数 child に同時取込する場合のオプション (#2362 PR-4、ADR-0055)。
 *
 * marketplace 取込フロー (取込ダイアログ「全員に追加」/ 個別選択) で利用。
 * 単一 child は `ImportRewardSetOptions.childId` 経由 (既存互換)。
 */
export interface ImportRewardSetToChildrenOptions {
	presetId: string;
	/** 適用対象 child ID 配列 (1 件以上必須、空は呼出側で排除) */
	childIds: readonly ChildId[];
}

/**
 * per-child bulk 取込結果。`imported / skipped / errors` は全 child 合算、
 * `byChild` は target child 別の内訳 (UI feedback 用)。
 */
export interface RewardSetImportToChildrenResult {
	imported: number;
	skipped: number;
	errors: string[];
	/** #2830: 全 child 合算の実失敗 reward 行数 (errors.length と分離、UI 件数表示用)。 */
	failed: number;
	/** target child 別の取込件数 (UI 表示 / debug 用) */
	byChild: Record<string, { imported: number; skipped: number; errors: number }>;
}

// ---------- preview ----------

/**
 * preset 取込時の preview を返す。実際の DB 書込は行わない。
 *
 * 重複判定: `sourcePresetId === presetId` の reward が既に存在し、
 * かつ同一 title である場合のみ「重複」とみなす。これにより、
 * ユーザーが手動で同名 reward を作っていても誤検知しない。
 *
 * @deprecated #2366 (ADR-0052): reward-set Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/reward-set-strategy` 経由で本関数を呼び出し、
 *   戻り値は `ImportPreview` shape に正規化されます。1 release 経過後撤去予定。
 */
export async function previewRewardSetImport(
	rewards: RewardSetItem[],
	presetId: string,
	childId: ChildId,
	tenantId: string,
	dedupMode: RewardDedupMode = 'preset-scope',
): Promise<RewardSetImportPreview> {
	const existing = await findSpecialRewards(childId, tenantId);
	const matcher = buildRewardDuplicateMatcher(existing, presetId, dedupMode);

	const duplicateTitles: string[] = [];
	let newCount = 0;

	for (const r of rewards) {
		if (matcher.isDuplicate(r)) {
			duplicateTitles.push(r.title);
		} else {
			newCount++;
		}
	}

	return {
		total: rewards.length,
		newRewards: newCount,
		duplicates: duplicateTitles.length,
		duplicateTitles,
	};
}

// ---------- import ----------

/**
 * reward-set を子供に一括取込する（mergeモード: 同一 preset の重複はスキップ）。
 *
 * 注意: reward は本来「実績付与時点でポイント加算」するものだが、
 * preset 取込は「将来付与する候補リスト」として `special_rewards` 行を作る運用ではない。
 * ここでは ADR-0013 (LP truth) に従い「親が選んだ preset の reward を子供のごほうび履歴に追加する」
 * セマンティクスとする — `grantSpecialReward` と同じく即時付与（点数加算）する。
 *
 * ただし grantSpecialReward は `insertPointEntry` も同時に呼んで点数加算するが、
 * preset 一括取込で大量の点数を一気に与えるのは設計上望ましくないため、
 * 本サービスは **reward レコードのみ作成し、ポイント加算は行わない**。
 * これにより、preset 取込は「ごほうび候補の事前登録」として機能する。
 *
 * @deprecated #2366 (ADR-0052): reward-set Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/reward-set-strategy` が本関数を内部 callee として参照中。
 *   外部 callsite は Strategy 内部のみ (Strangler Fig)。1 release 経過後撤去予定。
 */
export async function importRewardSet(
	rewards: RewardSetItem[],
	tenantId: string,
	options: ImportRewardSetOptions,
): Promise<RewardSetImportResult> {
	const { presetId, childId, dedupMode = 'preset-scope' } = options;

	const existing = await findSpecialRewards(childId, tenantId);
	const matcher = buildRewardDuplicateMatcher(existing, presetId, dedupMode);

	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	for (const r of rewards) {
		if (matcher.isDuplicate(r)) {
			skipped++;
			continue;
		}

		try {
			await insertSpecialReward(
				{
					childId,
					grantedBy: null,
					title: r.title,
					description: r.description,
					points: r.points,
					icon: r.icon,
					category: r.category,
					sourcePresetId: presetId,
					// #3147: preset 由来の shop_category を round-trip (null は表示側 fallback)
					shopCategory: r.shopCategory ?? null,
				},
				tenantId,
			);
			imported++;
			matcher.markImported(r);
		} catch (e) {
			errors.push(`「${r.title}」: ${String(e)}`);
		}
	}

	logger.info('[reward-set-import] インポート完了', {
		context: {
			tenantId,
			childId,
			presetId,
			imported,
			skipped,
			errors: errors.length,
		},
	});

	// #2830: per-reward try/catch のため失敗 reward 数 = errors.length。
	// #2955 注意: この等式は「1 reward = 1 error 行」の per-item 設計が前提。将来 bulk persist 化する場合は activity/challenge と同じ行数ベース集計 (planned - persisted) への再設計が必須。
	return { imported, skipped, errors, failed: errors.length };
}

/**
 * 複数 child に同一 reward-set を一括取込する (#2362 PR-4、ADR-0055)。
 *
 * 各 child について `importRewardSet` を順次実行し、結果を集約する。
 * 1 child の取込失敗が他 child を blocking しない (partial success 許容)。
 *
 * @param rewards    取込対象 reward 配列 (RewardSetPayload['rewards'])
 * @param tenantId   テナント ID
 * @param options    presetId + childIds 配列
 */
export async function importRewardSetToChildren(
	rewards: RewardSetItem[],
	tenantId: string,
	options: ImportRewardSetToChildrenOptions,
): Promise<RewardSetImportToChildrenResult> {
	const { presetId, childIds } = options;
	const byChild: Record<string, { imported: number; skipped: number; errors: number }> = {};
	let totalImported = 0;
	let totalSkipped = 0;
	let totalFailed = 0;
	const allErrors: string[] = [];

	for (const childId of childIds) {
		const result = await importRewardSet(rewards, tenantId, { presetId, childId });
		byChild[childId] = {
			imported: result.imported,
			skipped: result.skipped,
			errors: result.errors.length,
		};
		totalImported += result.imported;
		totalSkipped += result.skipped;
		totalFailed += result.failed;
		for (const e of result.errors) {
			allErrors.push(`child ${childId}: ${e}`);
		}
	}

	logger.info('[reward-set-import] per-child 一括インポート完了', {
		context: {
			tenantId,
			presetId,
			childCount: childIds.length,
			totalImported,
			totalSkipped,
			errorCount: allErrors.length,
		},
	});

	return {
		imported: totalImported,
		skipped: totalSkipped,
		errors: allErrors,
		failed: totalFailed,
		byChild,
	};
}
