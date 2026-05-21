// src/lib/server/services/rule-preset-import-service.ts
//
// @deprecated Issue #2368 / EPIC #2362 P3 / ADR-0052:
//   本 service は新 `rulePresetStrategy` (`$lib/marketplace/strategies/rule-preset-strategy`)
//   に置き換えられた。新 callsite は `marketplaceRegistry.get('rule-preset').strategy` 経由で
//   呼ぶこと。本 service は Strangler Fig 期間 (1 release) の後方互換のみを目的とし、
//   bonus state KVS の SSOT は `$lib/marketplace/strategies/rule-preset/bonus-state` に
//   移動済 — 本 service の `loadBonusOverrides` / `saveBonusOverrides` /
//   `setBonusPresetEnabled` / `removeBonusPreset` は新 SSOT への薄い re-export に縮退。
//
// 旧仕様メモ (#2138 MP-3 / Phase Marketplace research #2 軸 C):
// - exchange → `special_rewards` 系へマッピング (reward-set-import-service と同形)
// - bonus    → `settings.rule_preset_bonus_overrides` JSON 拡張で取込 (settings KVS)
// - penalty  → 型定義保持 + 取込時に「未実装 ruleType」warning + import_warnings に記録
// - special  → 同上 (将来枠、JSON 実件数 0)
//
// ADR-0012 Anti-engagement: penalty は Octalysis Drive 8 (black hat)、本サービスは
// インフラのみ実装し、子供 UI への表示は構造的禁止 (penalty 取込時に warning を返却し、
// admin 画面のみ「既定 disabled」状態で記録)。詳細は ADR-0012 §6 細則表参照。
//
// 重複検出: bonus / exchange 共通で sourcePresetId を利用 (#1254 G1)。

import type { RulePresetPayload } from '$lib/domain/marketplace-item';
import {
	BONUS_OVERRIDES_KEY as BONUS_OVERRIDES_KEY_NEW,
	type BonusOverridesState,
	type BonusPresetEntry,
	type BonusRuleSpec,
	loadBonusOverrides as loadBonusOverridesNew,
	removeBonusPreset as removeBonusPresetNew,
	saveBonusOverrides as saveBonusOverridesNew,
	setBonusPresetEnabled as setBonusPresetEnabledNew,
} from '$lib/marketplace/strategies/rule-preset/bonus-state';
import { RULE_PRESET_WARNINGS_KEY as RULE_PRESET_WARNINGS_KEY_NEW } from '$lib/marketplace/strategies/rule-preset/warning-log';

/** @deprecated test ガード用、本番 import path は新 SSOT を使う */
const DEPRECATION_WARNED = new Set<string>();
function warnDeprecated(symbol: string): void {
	if (DEPRECATION_WARNED.has(symbol)) return;
	DEPRECATION_WARNED.add(symbol);
	console.warn(
		`[DEPRECATED #2368] rule-preset-import-service.${symbol} は @deprecated です。` +
			'$lib/marketplace/strategies/rule-preset-strategy / $lib/marketplace/strategies/rule-preset/bonus-state 経由に移行してください。',
	);
}

// ============================================================
// 設定 KVS キー (SSOT は新 module、本 service は re-export のみ)
// ============================================================

/** @deprecated #2368: `$lib/marketplace/strategies/rule-preset/bonus-state` に移動 */
export const BONUS_OVERRIDES_KEY = BONUS_OVERRIDES_KEY_NEW;

/** @deprecated #2368: `$lib/marketplace/strategies/rule-preset/warning-log` に移動 */
export const RULE_PRESET_WARNINGS_KEY = RULE_PRESET_WARNINGS_KEY_NEW;

// ============================================================
// 型定義 (re-export only)
// ============================================================

/** @deprecated #2368: re-export from $lib/marketplace/strategies/rule-preset/bonus-state */
export type { BonusOverridesState, BonusPresetEntry, BonusRuleSpec };

/** penalty / special の取込試行 warning */
export interface RulePresetWarning {
	presetId: string;
	ruleType: 'penalty' | 'special';
	/** ADR-0012 §6 細則表で penalty が unimplemented 状態であることの説明 */
	reason: string;
	timestamp: string;
}

// ============================================================
// 取込結果 / preview
// ============================================================

export interface RulePresetImportPreview {
	presetId: string;
	presetName: string;
	presetIcon: string;
	ruleType: RulePresetPayload['ruleType'];
	/** preset 内の rule 数 */
	ruleCount: number;
	/** 既に同 preset で取込済か (bonus / exchange のみ判定、penalty/special は常に false) */
	alreadyImported: boolean;
}

export interface RulePresetImportResult {
	/** 取込成功 (bonus: 1 件 = preset 追加成功 / exchange: insert 件数) */
	imported: number;
	/** 重複 / skip 件数 */
	skipped: number;
	/** 警告メッセージ (penalty / special 取込試行など) */
	warnings: string[];
	/** エラーメッセージ */
	errors: string[];
}

// ============================================================
// preview / import (@deprecated #2368: 内部は新 Strategy に委譲)
// ============================================================

/**
 * @deprecated Issue #2368: 新 callsite は
 *   `marketplaceRegistry.get('rule-preset').strategy.previewRulePreset(...)`
 *   を使う。本関数は Strangler Fig 期間の後方互換のため新 Strategy へ薄く委譲する。
 */
// biome-ignore lint/complexity/useMaxParams: 旧 API シグネチャ互換のため
export async function previewRulePresetImport(
	presetId: string,
	presetName: string,
	presetIcon: string,
	payload: RulePresetPayload,
	tenantId: string,
	childId?: number,
): Promise<RulePresetImportPreview> {
	warnDeprecated('previewRulePresetImport');
	const { rulePresetStrategy } = await import(
		'$lib/marketplace/strategies/rule-preset-strategy.js'
	);
	return rulePresetStrategy.previewRulePreset({ presetId, presetName, presetIcon }, payload, {
		tenantId,
		childId,
	});
}

export interface ImportRulePresetOptions {
	/** exchange ruleType の取込先 子供 ID。bonus / penalty / special では使わない。 */
	childId?: number;
}

/**
 * @deprecated Issue #2368: 新 callsite は
 *   `marketplaceRegistry.get('rule-preset').strategy.applyRulePreset(...)` を使う。
 *   本関数は Strangler Fig 期間の後方互換のため新 Strategy へ薄く委譲する。
 */
// biome-ignore lint/complexity/useMaxParams: 旧 API シグネチャ互換のため
export async function importRulePreset(
	presetId: string,
	presetName: string,
	presetIcon: string,
	payload: RulePresetPayload,
	tenantId: string,
	options?: ImportRulePresetOptions,
): Promise<RulePresetImportResult> {
	warnDeprecated('importRulePreset');
	const { rulePresetStrategy } = await import(
		'$lib/marketplace/strategies/rule-preset-strategy.js'
	);
	return rulePresetStrategy.applyRulePreset({ presetId, presetName, presetIcon }, payload, {
		tenantId,
		childId: options?.childId,
	});
}

// ============================================================
// bonus overrides KVS 読み書き
// (@deprecated #2368: SSOT は $lib/marketplace/strategies/rule-preset/bonus-state)
// ============================================================

/** @deprecated #2368: `$lib/marketplace/strategies/rule-preset/bonus-state.loadBonusOverrides` を使ってください */
export async function loadBonusOverrides(tenantId: string): Promise<BonusOverridesState> {
	warnDeprecated('loadBonusOverrides');
	return loadBonusOverridesNew(tenantId);
}

/** @deprecated #2368: `$lib/marketplace/strategies/rule-preset/bonus-state.saveBonusOverrides` を使ってください */
export async function saveBonusOverrides(
	state: BonusOverridesState,
	tenantId: string,
): Promise<void> {
	warnDeprecated('saveBonusOverrides');
	return saveBonusOverridesNew(state, tenantId);
}

/** @deprecated #2368: `$lib/marketplace/strategies/rule-preset/bonus-state.setBonusPresetEnabled` を使ってください */
export async function setBonusPresetEnabled(
	presetId: string,
	enabled: boolean,
	tenantId: string,
): Promise<void> {
	warnDeprecated('setBonusPresetEnabled');
	return setBonusPresetEnabledNew(presetId, enabled, tenantId);
}

/** @deprecated #2368: `$lib/marketplace/strategies/rule-preset/bonus-state.removeBonusPreset` を使ってください */
export async function removeBonusPreset(presetId: string, tenantId: string): Promise<void> {
	warnDeprecated('removeBonusPreset');
	return removeBonusPresetNew(presetId, tenantId);
}

// penalty / special audit log helper は
// $lib/marketplace/strategies/rule-preset/warning-log に移動済。
