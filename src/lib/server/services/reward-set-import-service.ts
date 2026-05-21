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
	childId: number;
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
	childId: number,
	tenantId: string,
): Promise<RewardSetImportPreview> {
	const existing = await findSpecialRewards(childId, tenantId);
	const sameSourceTitles = new Set(
		existing.filter((r) => r.sourcePresetId === presetId).map((r) => r.title),
	);

	const duplicateTitles: string[] = [];
	let newCount = 0;

	for (const r of rewards) {
		if (sameSourceTitles.has(r.title)) {
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
	const { presetId, childId } = options;

	const existing = await findSpecialRewards(childId, tenantId);
	const sameSourceTitles = new Set(
		existing.filter((r) => r.sourcePresetId === presetId).map((r) => r.title),
	);

	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	for (const r of rewards) {
		if (sameSourceTitles.has(r.title)) {
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
				},
				tenantId,
			);
			imported++;
			sameSourceTitles.add(r.title);
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

	return { imported, skipped, errors };
}
