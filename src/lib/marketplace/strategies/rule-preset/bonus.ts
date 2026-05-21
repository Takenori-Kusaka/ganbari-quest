/**
 * rule-preset `bonus` sub-strategy (Issue #2368)
 *
 * `settings.rule_preset_bonus_overrides` JSON に preset 全体を追記する。
 * 個別 rule は `bonus-hook-service` が読み出して活動記録時に適用する。
 *
 * 設計原則 (ADR-0052 §3 Strategy 内部 OCP):
 *   - 1 ruleType = 1 sub-module。本 module は bonus のみを扱う
 *   - settings KVS read/write helpers は `./bonus-state.ts` に分離 (state I/O のみ)
 *
 * ADR-0012 Anti-engagement 整合:
 *   - bonus は streak / 早起き / カテゴリ達成等の **positive reinforcement** のみ
 *   - 連続ガチャ / インフィニットスクロール等の anti-pattern を含まない
 *   - 親管理画面で個別に ON/OFF 可能 (default true) — 通知連打にならない構造
 *
 * 関連:
 *   - $lib/server/services/bonus-hook-service (本 sub-strategy 経由で state 取得)
 *   - ADR-0023 archive (tenant isolation 強制)
 */

import type { RulePresetPayload } from '$lib/marketplace/schemas/rule-preset-schema.js';
import { loadBonusOverrides, saveBonusOverrides } from './bonus-state.js';

export interface BonusPreviewResult {
	/** settings KVS に同 presetId が既存か */
	alreadyImported: boolean;
	/** payload 内の rule 総数 */
	ruleCount: number;
}

export interface BonusApplyResult {
	imported: number;
	skipped: number;
	errors: string[];
}

/** bonus preview: settings KVS の `rule_preset_bonus_overrides` に同 presetId が存在するか */
export async function previewBonus(
	presetId: string,
	payload: RulePresetPayload,
	tenantId: string,
): Promise<BonusPreviewResult> {
	const state = await loadBonusOverrides(tenantId);
	const alreadyImported = state.presets.some((p) => p.presetId === presetId);
	return { alreadyImported, ruleCount: payload.rules.length };
}

/**
 * bonus apply: settings KVS に preset 全体を追記する。
 * 同 presetId が既存なら skipped=1 で no-op。
 */
export async function applyBonus(
	presetId: string,
	presetName: string,
	presetIcon: string,
	payload: RulePresetPayload,
	tenantId: string,
): Promise<BonusApplyResult> {
	const errors: string[] = [];
	const state = await loadBonusOverrides(tenantId);

	if (state.presets.some((p) => p.presetId === presetId)) {
		return { imported: 0, skipped: 1, errors };
	}

	state.presets.push({
		presetId,
		presetName,
		presetIcon,
		enabled: true,
		rules: payload.rules.map((r) => ({
			title: r.title,
			description: r.description,
			icon: r.icon,
			pointBonus: r.pointBonus ?? 0,
		})),
		importedAt: new Date().toISOString(),
	});

	try {
		await saveBonusOverrides(state, tenantId);
		return { imported: 1, skipped: 0, errors };
	} catch (e) {
		errors.push(`bonus preset 保存失敗: ${String(e)}`);
		return { imported: 0, skipped: 0, errors };
	}
}
