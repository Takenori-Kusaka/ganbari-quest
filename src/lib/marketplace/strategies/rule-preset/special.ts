/**
 * rule-preset `special` sub-strategy (Issue #2368)
 *
 * 将来枠、仕様未確定のため意図的 no-op。
 * penalty 同様、取込試行を audit log に記録するのみ。
 *
 * 動作:
 *   - imported=0, skipped=0
 *   - warning 文字列を返却
 *   - `settings.rule_preset_import_warnings` に audit log を記録
 *
 * 関連:
 *   - ADR-0052 §3 (Strategy 内部 sub-dispatcher における将来枠の保留扱い)
 *   - ./warning-log.ts (audit log shared helper)
 */

import { recordRulePresetWarning } from './warning-log.js';

export interface SpecialApplyResult {
	imported: 0;
	skipped: 0;
	warnings: string[];
	errors: string[];
}

const SPECIAL_REASON = 'special ruleType は将来枠、仕様未確定のため本取込は no-op';

/**
 * special apply: 意図的 no-op。warning を返却し audit log に記録する。
 */
export async function applySpecial(
	presetId: string,
	tenantId: string,
): Promise<SpecialApplyResult> {
	await recordRulePresetWarning(
		{
			presetId,
			ruleType: 'special',
			reason: SPECIAL_REASON,
			timestamp: new Date().toISOString(),
		},
		tenantId,
	);
	return {
		imported: 0,
		skipped: 0,
		warnings: [SPECIAL_REASON],
		errors: [],
	};
}
