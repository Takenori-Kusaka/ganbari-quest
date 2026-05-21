/**
 * rule-preset `penalty` sub-strategy (Issue #2368)
 *
 * **ADR-0012 §6 細則による意図的 no-op**: penalty は Octalysis Drive 8 (black hat)
 * 該当のため慎重審査中。インフラ (型定義 / 取込試行 audit log) のみ保持し、
 * 実際の preset 投入は別 ADR 合意の上で個別に行う。
 *
 * 動作:
 *   - imported=0, skipped=0 (試行は audit log に残す)
 *   - warning 文字列を返却 (UI 側で親に提示)
 *   - `settings.rule_preset_import_warnings` に audit log を記録
 *
 * 関連:
 *   - ADR-0012 §6 (anti-engagement の penalty 制限)
 *   - ADR-0052 §3 (Strategy 内部 sub-dispatcher の中で意図的 no-op を分離)
 *   - ./warning-log.ts (audit log shared helper)
 */

import { recordRulePresetWarning } from './warning-log.js';

export interface PenaltyApplyResult {
	imported: 0;
	skipped: 0;
	warnings: string[];
	errors: string[];
}

const PENALTY_REASON =
	'penalty ruleType は ADR-0012 §6 細則で慎重審査中 (Octalysis Drive 8 black hat 該当)。実装インフラは保持、preset 投入は別 Issue で個別合意の上で行う';

/**
 * penalty apply: 意図的 no-op。warning を返却し audit log に記録する。
 * `imported / skipped` は型レベルで 0 固定 (リテラル型) — interface 上で
 * tenant isolation と合わせて契約を破られない設計。
 */
export async function applyPenalty(
	presetId: string,
	tenantId: string,
): Promise<PenaltyApplyResult> {
	await recordRulePresetWarning(
		{
			presetId,
			ruleType: 'penalty',
			reason: PENALTY_REASON,
			timestamp: new Date().toISOString(),
		},
		tenantId,
	);
	return {
		imported: 0,
		skipped: 0,
		warnings: [PENALTY_REASON],
		errors: [],
	};
}
