/**
 * penalty / special 取込試行 warning の audit log helper (Issue #2368)
 *
 * 旧 `rule-preset-import-service.ts` の private `recordRulePresetWarning` を
 * sub-strategy で共有するため新 module に切り出した SSOT。
 *
 * `settings.rule_preset_import_warnings` KVS に直近 100 件を JSON 配列で保持する。
 *
 * 関連:
 *   - ADR-0012 §6 細則 (penalty unimplemented 状態の audit)
 *   - ADR-0052 (Strategy 内部 sub-dispatcher における共有 helper)
 */

import { getSetting, setSetting } from '$lib/server/db/settings-repo';

/** penalty / special 取込試行 warning */
export interface RulePresetWarning {
	presetId: string;
	ruleType: 'penalty' | 'special';
	/** ADR-0012 §6 細則表で penalty が unimplemented 状態であることの説明 */
	reason: string;
	timestamp: string;
}

/** penalty / special 取込時の warning 履歴: 取込試行を audit ログとして残す */
export const RULE_PRESET_WARNINGS_KEY = 'rule_preset_import_warnings';

/** 直近保持件数 (settings KVS 肥大化防止) */
const MAX_WARNINGS = 100;

/**
 * penalty / special 取込試行を audit log として settings に記録する。
 *
 * 不正 JSON は破棄して新規 array で上書き (graceful degradation)。
 */
export async function recordRulePresetWarning(
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
			// 不正 JSON は破棄
		}
	}
	warnings.push(warning);
	if (warnings.length > MAX_WARNINGS) {
		warnings = warnings.slice(-MAX_WARNINGS);
	}
	await setSetting(RULE_PRESET_WARNINGS_KEY, JSON.stringify(warnings), tenantId);
}
