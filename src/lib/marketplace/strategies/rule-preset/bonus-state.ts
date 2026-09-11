/**
 * bonus ruleType の settings KVS state SSOT (Issue #2368)
 *
 * 旧 `rule-preset-import-service.ts` の bonus overrides 部分を新 module に切り出した
 * SSOT。`bonus-hook-service` および admin/settings/rules 配下の callsite から
 * 本 module を直接参照する (旧 service への依存を撤去するため)。
 *
 * 設計原則:
 *   - `settings.rule_preset_bonus_overrides` JSON の read/write のみを担当
 *   - graceful degradation: settings repo 例外時は空 state を返却 (test 環境
 *     で settings テーブル不在等を考慮)
 *   - bonus 取込本体の sub-strategy (`./bonus.ts`) と分離: state I/O のみ
 *
 * 関連:
 *   - ADR-0052 §3 (Strategy 内部の OCP: sub-strategy 群に分割)
 *   - ADR-0023 archive (tenant isolation 強制)
 */

import { getMarketplaceItem } from '$lib/data/marketplace';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';

/** settings KVS キー (SSOT) */
export const BONUS_OVERRIDES_KEY = 'rule_preset_bonus_overrides';

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

/**
 * `settings.rule_preset_bonus_overrides` を JSON parse して返す。
 *
 * graceful degradation: 未設定 / 不正 JSON / settings テーブル不在では空 state。
 */
export async function loadBonusOverrides(tenantId: string): Promise<BonusOverridesState> {
	let raw: string | null | undefined;
	try {
		raw = await getSetting(BONUS_OVERRIDES_KEY, tenantId);
	} catch (e) {
		logger.warn(
			'[rule-preset-strategy] getSetting 失敗、bonus overrides を空 state にフォールバック',
			{ context: { tenantId, error: String(e) } },
		);
		return { presets: [] };
	}
	if (!raw) return { presets: [] };
	try {
		const parsed = JSON.parse(raw) as BonusOverridesState;
		if (!parsed || !Array.isArray(parsed.presets)) {
			return { presets: [] };
		}
		return { ...parsed, presets: parsed.presets.map(normalizePresetIdentity) };
	} catch (e) {
		logger.warn(
			'[rule-preset-strategy] bonus overrides JSON parse 失敗、空 state にフォールバック',
			{ context: { tenantId, error: String(e) } },
		);
		return { presets: [] };
	}
}

/**
 * #4711: 保存済 entry の表示名 / icon を marketplace SSOT から引き直す (read-path fallback)。
 *
 * 旧 generic 取込経路は `presetName: presetId` / `presetIcon: ''` で保存していたため、
 * 既存テナントの settings KVS には内部 ID が表示名として残っている。読み出し時に
 * presetId から marketplace item を引いて表示名 / icon を補完し、次回 save で永続化される。
 * marketplace から撤去済の preset (sibling-coop 等) は item が無いので保存値をそのまま返す。
 */
function normalizePresetIdentity(entry: BonusPresetEntry): BonusPresetEntry {
	const needsName = !entry.presetName || entry.presetName === entry.presetId;
	const needsIcon = !entry.presetIcon;
	if (!needsName && !needsIcon) return entry;
	const item = getMarketplaceItem('rule-preset', entry.presetId);
	if (!item) return entry;
	return {
		...entry,
		presetName: needsName ? item.name : entry.presetName,
		presetIcon: needsIcon ? item.icon : entry.presetIcon,
	};
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
