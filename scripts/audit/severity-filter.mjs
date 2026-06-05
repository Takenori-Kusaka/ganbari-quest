/**
 * scripts/audit/severity-filter.mjs (EPIC #2861 / B4 = #2867)
 *
 * severity 閾値 filter (audit-team.md §3.6 [3] / audit-manager.md §E [4])。
 *   - severity 1-2 (軽微) = backlog 蓄積のみ (起票しない)
 *   - severity 3-4 (重大) = 次段 (ポリシー準拠 filter → 起票候補) へ
 *
 * 「全件発露 → 重複統合 → severity filter (3-4 のみ) → ポリシー準拠 filter」の
 * 固定時間 box 運用 (EPIC PO 判断 7 / 失敗シナリオ⑥)。本 module は severity 段のみ。
 * ポリシー準拠判定は policy-compliance skill (LLM 判定) が担い、CI には載せない
 * (EPIC 設計原則 1 — hard gate は rules-based のみ)。
 *
 * pure function (副作用なし)。vitest: tests/unit/audit/severity-filter.test.ts
 */

/** severity 3 以上を「重大」とし次段へ送る閾値 (audit-team.md §3.6 [3]) */
export const SEVERITY_ESCALATION_THRESHOLD = 3;

/**
 * 重複統合後の finding 群を severity で分割する。
 *
 * @param {Array<any>} findings dedupe 済み finding 配列
 * @returns {{
 *   escalated: Array<any>,   // severity 3-4 — 次段 (policy filter) へ
 *   backlog: Array<any>,     // severity 1-2 — backlog 蓄積のみ
 *   threshold: number,
 * }}
 */
export function partitionBySeverity(findings) {
	/** @type {any[]} */
	const escalated = [];
	/** @type {any[]} */
	const backlog = [];
	for (const f of findings) {
		const sev = Number.isInteger(f?.severity) ? f.severity : 0;
		if (sev >= SEVERITY_ESCALATION_THRESHOLD) {
			escalated.push(f);
		} else {
			backlog.push(f);
		}
	}
	return { escalated, backlog, threshold: SEVERITY_ESCALATION_THRESHOLD };
}
