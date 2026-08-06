/**
 * rule-preset `exchange` sub-strategy (Issue #2368)
 *
 * `special_rewards` テーブルに各 rule を挿入する (reward-set-import と同形)。
 * `sourcePresetId` で重複検知を行う。
 *
 * 設計原則 (ADR-0052 §3 Strategy 内部 OCP):
 *   - 1 ruleType = 1 sub-module。本 module は exchange のみを扱う
 *   - childId は必須 (上位 dispatcher で事前検証)
 *
 * 関連:
 *   - $lib/server/db/special-reward-repo
 *   - ADR-0023 archive (tenant isolation 強制)
 */

import type { ChildId } from '$lib/domain/ids';
import type { RulePresetPayload } from '$lib/marketplace/schemas/rule-preset-schema.js';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';

export interface ExchangePreviewResult {
	/** 既に同 sourcePresetId が special_rewards に存在するか */
	alreadyImported: boolean;
	/** payload 内の rule 総数 */
	ruleCount: number;
	/** #4373: 取込を実行した場合に挿入される件数 (dryRun の判断材料)。 */
	wouldImport: number;
	/** #4373: 取込を実行した場合に重複で skip される件数 (dryRun の判断材料)。 */
	wouldSkip: number;
}

/**
 * #4373: 「同 sourcePresetId + 同 title は skip」という重複判定を preview と apply で共有する。
 *
 * dryRun の予測を apply とは別ロジックで書くと、両者が静かにズレて
 * 「予測は 0 件、実行すると 3 件」という嘘が再生産される。判定は 1 箇所に置く。
 */
function collectSameSourceTitles(
	presetId: string,
	existing: Array<{ sourcePresetId?: string | null; title: string }>,
): Set<string> {
	return new Set(existing.filter((r) => r.sourcePresetId === presetId).map((r) => r.title));
}

export interface ExchangeApplyResult {
	imported: number;
	skipped: number;
	errors: string[];
}

/**
 * exchange preview: childId 必須、`special_rewards` に同 sourcePresetId 在処を確認。
 */
export async function previewExchange(
	presetId: string,
	payload: RulePresetPayload,
	tenantId: string,
	childId?: ChildId,
): Promise<ExchangePreviewResult> {
	const ruleCount = payload.rules.length;
	if (childId === undefined) {
		// childId 無しでは apply が errors で fail するため、取込は 0 件と予測する
		return { alreadyImported: false, ruleCount, wouldImport: 0, wouldSkip: 0 };
	}
	const existing = await findSpecialRewards(childId, tenantId);
	const alreadyImported = existing.some((r) => r.sourcePresetId === presetId);
	// apply と同じ走査 (挿入済 title を都度 Set に足す) で payload 内の重複も同じ数に揃える
	const seen = collectSameSourceTitles(presetId, existing);
	let wouldSkip = 0;
	for (const rule of payload.rules) {
		if (seen.has(rule.title)) {
			wouldSkip++;
			continue;
		}
		seen.add(rule.title);
	}
	return { alreadyImported, ruleCount, wouldImport: ruleCount - wouldSkip, wouldSkip };
}

/**
 * exchange apply: 各 rule を `special_rewards` に挿入。
 * childId 未指定は errors で fail (上位で事前検証する想定だが防御的に再確認)。
 * 同 sourcePresetId + 同 title の既存 reward は skipped。
 */
export async function applyExchange(
	presetId: string,
	payload: RulePresetPayload,
	tenantId: string,
	childId: ChildId | undefined,
): Promise<ExchangeApplyResult> {
	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	if (childId === undefined) {
		errors.push('exchange ruleType の取込には childId が必要です');
		return { imported, skipped, errors };
	}

	const existing = await findSpecialRewards(childId, tenantId);
	const sameSourceTitles = collectSameSourceTitles(presetId, existing);

	for (const rule of payload.rules) {
		if (sameSourceTitles.has(rule.title)) {
			skipped++;
			continue;
		}
		try {
			await insertSpecialReward(
				{
					childId,
					grantedBy: null,
					title: rule.title,
					description: rule.description,
					// exchange は pointCost をポイントとして保存 (子供がポイントを使って交換)
					points: rule.pointCost ?? 0,
					icon: rule.icon,
					category: 'rule-preset-exchange',
					sourcePresetId: presetId,
				},
				tenantId,
			);
			imported++;
			sameSourceTitles.add(rule.title);
		} catch (e) {
			errors.push(`「${rule.title}」: ${String(e)}`);
		}
	}

	return { imported, skipped, errors };
}
