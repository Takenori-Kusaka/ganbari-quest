// src/lib/server/services/rule-preset-import-service.ts
// #2138 MP-3: rule-preset 4 ruleType 全対応 一括取込サービス
//
// 案 1「既存テーブル流用」採用 (Phase Marketplace research #2 軸 C):
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
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';
import { logger } from '$lib/server/logger';

// ============================================================
// 設定 KVS キー (SSOT)
// ============================================================

/** bonus 取込状態: tenant スコープで取込済 preset の payload + 有効/無効を保持 */
export const BONUS_OVERRIDES_KEY = 'rule_preset_bonus_overrides';

/** penalty / special 取込時の warning 履歴: 取込試行を audit ログとして残す */
export const RULE_PRESET_WARNINGS_KEY = 'rule_preset_import_warnings';

// ============================================================
// 型定義
// ============================================================

/** bonus 取込状態 (settings KVS に JSON 直列化して格納) */
export interface BonusOverridesState {
	/** preset 単位の取込履歴 */
	presets: BonusPresetEntry[];
}

export interface BonusPresetEntry {
	/** preset itemId (例: 'streak-bonus' / 'early-bird') */
	presetId: string;
	/** preset 表示名 (UI 表示用キャッシュ) */
	presetName: string;
	/** preset icon (UI 表示用キャッシュ) */
	presetIcon: string;
	/** 親が ON/OFF できる。既定は true (有効) */
	enabled: boolean;
	/** preset の rules (bonus-hook-service で参照) */
	rules: BonusRuleSpec[];
	/** 取込日時 ISO */
	importedAt: string;
}

export interface BonusRuleSpec {
	title: string;
	description: string;
	icon: string;
	/** bonus 額 (pointBonus が undefined / 0 のときも保持) */
	pointBonus: number;
}

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
// preview
// ============================================================

/**
 * rule-preset 取込時の preview を返す。実際の DB 書込は行わない。
 *
 * 重複判定:
 * - exchange: `special_rewards.sourcePresetId === presetId` の存在で判定 (reward-set と同形)
 * - bonus: `settings.rule_preset_bonus_overrides` JSON 内の presets[].presetId で判定
 * - penalty / special: 常に alreadyImported=false (取込試行のたびに warning が積まれる)
 */
// biome-ignore lint/complexity/useMaxParams: marketplace item の identity 3 つ (id/name/icon) + payload + tenantId + 任意 childId は SSOT 統合のため必須
export async function previewRulePresetImport(
	presetId: string,
	presetName: string,
	presetIcon: string,
	payload: RulePresetPayload,
	tenantId: string,
	childId?: number,
): Promise<RulePresetImportPreview> {
	const ruleType = payload.ruleType;
	const ruleCount = payload.rules.length;

	let alreadyImported = false;

	if (ruleType === 'exchange' && childId !== undefined) {
		// exchange: 既存 special_rewards テーブルに同 sourcePresetId が存在するか
		const existing = await findSpecialRewards(childId, tenantId);
		alreadyImported = existing.some((r) => r.sourcePresetId === presetId);
	} else if (ruleType === 'bonus') {
		// bonus: settings KVS の rule_preset_bonus_overrides JSON 内に同 presetId があるか
		const state = await loadBonusOverrides(tenantId);
		alreadyImported = state.presets.some((p) => p.presetId === presetId);
	}
	// penalty / special: 常に false

	return {
		presetId,
		presetName,
		presetIcon,
		ruleType,
		ruleCount,
		alreadyImported,
	};
}

// ============================================================
// import
// ============================================================

export interface ImportRulePresetOptions {
	/**
	 * exchange ruleType の取込先 子供 ID。bonus / penalty / special では使わない。
	 */
	childId?: number;
}

/**
 * rule-preset を 4 ruleType 全てに分岐して一括取込する。
 *
 * - exchange → `special_rewards` に各 rule を挿入 (reward-set-import と同形、pointCost が
 *   コスト = points として書き込まれる)
 * - bonus → `settings.rule_preset_bonus_overrides` JSON に preset 全体を追記
 *   (個別 rule は bonus-hook-service が読み出して活動記録時に適用)
 * - penalty / special → 取込はせず warning を返却 (audit log として
 *   settings.rule_preset_import_warnings に記録)
 *
 * 重複: 同一 preset が既取込なら何もせず skipped=1 で返却。
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 4 ruleType 分岐 + 例外処理を 1 ヶ所に集約するための必要複雑度
// biome-ignore lint/complexity/useMaxParams: marketplace item の identity 3 つ (id/name/icon) + payload + tenantId + options 統合のため必須
export async function importRulePreset(
	presetId: string,
	presetName: string,
	presetIcon: string,
	payload: RulePresetPayload,
	tenantId: string,
	options?: ImportRulePresetOptions,
): Promise<RulePresetImportResult> {
	const ruleType = payload.ruleType;
	const warnings: string[] = [];
	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	if (ruleType === 'exchange') {
		const childId = options?.childId;
		if (childId === undefined) {
			errors.push('exchange ruleType の取込には childId が必要です');
			return { imported: 0, skipped: 0, warnings, errors };
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
						// 未指定は 0 として扱う
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
	} else if (ruleType === 'bonus') {
		const state = await loadBonusOverrides(tenantId);
		if (state.presets.some((p) => p.presetId === presetId)) {
			skipped = 1;
		} else {
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
				imported = 1;
			} catch (e) {
				errors.push(`bonus preset 保存失敗: ${String(e)}`);
			}
		}
	} else if (ruleType === 'penalty' || ruleType === 'special') {
		// penalty: ADR-0012 §6 で「未実装 ruleType」として扱う (将来 ADR 合意後に解除)
		// special: 将来枠、現状は仕様未確定
		const reason =
			ruleType === 'penalty'
				? 'penalty ruleType は ADR-0012 §6 細則で慎重審査中 (Octalysis Drive 8 black hat 該当)。実装インフラは保持、preset 投入は別 Issue で個別合意の上で行う'
				: 'special ruleType は将来枠、仕様未確定のため本取込は no-op';
		warnings.push(reason);
		await recordRulePresetWarning(
			{
				presetId,
				ruleType,
				reason,
				timestamp: new Date().toISOString(),
			},
			tenantId,
		);
		// imported=0, skipped=0 (試行は audit log に残す)
	}

	logger.info('[rule-preset-import] インポート完了', {
		context: {
			tenantId,
			presetId,
			ruleType,
			imported,
			skipped,
			warnings: warnings.length,
			errors: errors.length,
		},
	});

	return { imported, skipped, warnings, errors };
}

// ============================================================
// bonus overrides KVS 読み書き (settings JSON SSOT)
// ============================================================

/**
 * `settings.rule_preset_bonus_overrides` を JSON parse して返す。
 * 未設定 / 不正 JSON / settings テーブル不在 (一部 integration test 環境) では空 state を返す。
 *
 * 公開 API: bonus-hook-service.ts が活動記録時の bonus 算出で参照する。
 * graceful degradation: settings repo が throw した場合も bonus 評価を no-op で進める
 * (regression なし、bonus 取込前と同じ挙動)。
 */
export async function loadBonusOverrides(tenantId: string): Promise<BonusOverridesState> {
	let raw: string | null | undefined;
	try {
		raw = await getSetting(BONUS_OVERRIDES_KEY, tenantId);
	} catch (e) {
		// settings repo の例外 (test 環境で settings テーブル不在等) は graceful degradation
		logger.warn(
			'[rule-preset-import] getSetting 失敗、bonus overrides を空 state にフォールバック',
			{
				context: { tenantId, error: String(e) },
			},
		);
		return { presets: [] };
	}
	if (!raw) return { presets: [] };
	try {
		const parsed = JSON.parse(raw) as BonusOverridesState;
		if (!parsed || !Array.isArray(parsed.presets)) {
			return { presets: [] };
		}
		return parsed;
	} catch (e) {
		logger.warn('[rule-preset-import] bonus overrides JSON parse 失敗、空 state にフォールバック', {
			context: { tenantId, error: String(e) },
		});
		return { presets: [] };
	}
}

/** state を JSON 直列化して `settings` テーブルに保存 */
export async function saveBonusOverrides(
	state: BonusOverridesState,
	tenantId: string,
): Promise<void> {
	await setSetting(BONUS_OVERRIDES_KEY, JSON.stringify(state), tenantId);
}

/**
 * 取込済 bonus preset の enabled フラグを切り替え (親管理画面の ON/OFF 用)。
 * preset が存在しない場合は no-op。
 */
export async function setBonusPresetEnabled(
	presetId: string,
	enabled: boolean,
	tenantId: string,
): Promise<void> {
	const state = await loadBonusOverrides(tenantId);
	const preset = state.presets.find((p) => p.presetId === presetId);
	if (!preset) return;
	preset.enabled = enabled;
	await saveBonusOverrides(state, tenantId);
}

/**
 * 取込済 bonus preset を削除 (親管理画面の削除ボタン用)。
 * preset が存在しない場合は no-op。
 */
export async function removeBonusPreset(presetId: string, tenantId: string): Promise<void> {
	const state = await loadBonusOverrides(tenantId);
	const before = state.presets.length;
	state.presets = state.presets.filter((p) => p.presetId !== presetId);
	if (state.presets.length === before) return;
	await saveBonusOverrides(state, tenantId);
}

// ============================================================
// penalty / special 取込 warning audit log
// ============================================================

/**
 * penalty / special 取込試行を audit log として settings に記録。
 * ADR-0012 §6 細則表で「インフラは保持、preset 投入は別 Issue」とした履歴を残す。
 */
async function recordRulePresetWarning(
	warning: RulePresetWarning,
	tenantId: string,
): Promise<void> {
	const raw = await getSetting(RULE_PRESET_WARNINGS_KEY, tenantId);
	let warnings: RulePresetWarning[] = [];
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) warnings = parsed;
		} catch {
			// 不正 JSON は破棄して新規 array で上書き
		}
	}
	warnings.push(warning);
	// 直近 100 件のみ保持 (settings KVS 肥大化防止)
	if (warnings.length > 100) {
		warnings = warnings.slice(-100);
	}
	await setSetting(RULE_PRESET_WARNINGS_KEY, JSON.stringify(warnings), tenantId);
}
