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

import type { RulePresetPayload } from '$lib/marketplace/schemas/rule-preset-schema.js';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';

export interface ExchangePreviewResult {
	/** 既に同 sourcePresetId が special_rewards に存在するか */
	alreadyImported: boolean;
	/** payload 内の rule 総数 */
	ruleCount: number;
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
	childId?: number,
): Promise<ExchangePreviewResult> {
	const ruleCount = payload.rules.length;
	if (childId === undefined) {
		return { alreadyImported: false, ruleCount };
	}
	const existing = await findSpecialRewards(childId, tenantId);
	const alreadyImported = existing.some((r) => r.sourcePresetId === presetId);
	return { alreadyImported, ruleCount };
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
	childId: number | undefined,
): Promise<ExchangeApplyResult> {
	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	if (childId === undefined) {
		errors.push('exchange ruleType の取込には childId が必要です');
		return { imported, skipped, errors };
	}

	const existing = await findSpecialRewards(childId, tenantId);
	const sameSourceTitles = new Set(
		existing.filter((r) => r.sourcePresetId === presetId).map((r) => r.title),
	);

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
