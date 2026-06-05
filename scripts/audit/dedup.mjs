/**
 * scripts/audit/dedup.mjs (EPIC #2861 / B4 = #2867)
 *
 * finding 重複統合 (audit-team.md §3.6 [2] / audit-manager.md §E [3])。
 * 文字列一致ではなく「ruleId + 正規化 location」= partialFingerprints ベースで
 * 同一根本原因の finding を 1 件にマージする (EPIC 設計原則 4)。
 *
 * pure function (副作用なし)。vitest: tests/unit/audit/dedup.test.ts
 *
 * 関連:
 *   - scripts/audit/evidence-schema.mjs (computeFingerprint を再利用)
 *   - .claude/agents/audit-manager.md §E [3] 重複統合
 */

import { computeFingerprint } from './evidence-schema.mjs';

/**
 * severity の大きい finding を「代表」に採る際の比較。
 * 同 severity なら最初に出現したものを代表とする (安定ソート相当)。
 * @param {any} a
 * @param {any} b
 * @returns {any} 代表として残す finding
 */
function pickRepresentative(a, b) {
	const sa = Number.isInteger(a?.severity) ? a.severity : 0;
	const sb = Number.isInteger(b?.severity) ? b.severity : 0;
	return sb > sa ? b : a;
}

/**
 * finding 配列を fingerprint で重複統合する。
 *
 * - 同一 fingerprint の finding 群は 1 件 (代表) に集約する。
 * - 代表は最大 severity の finding。集約された finding の出典 (team / id) を
 *   `merged_from` に列挙し、無言マージを避ける (証跡保持)。
 * - 代表の severity は群内最大に引き上げる (重大度の取りこぼし防止)。
 *
 * @param {Array<{ team: string, finding: any }>} taggedFindings
 *   各 finding に出所 team を付与した配列 (run-pipeline 側で flatten 済み)
 * @returns {{
 *   merged: Array<any>,
 *   inputCount: number,
 *   mergedCount: number,
 *   duplicatesRemoved: number,
 * }}
 */
export function dedupeFindings(taggedFindings) {
	const inputCount = taggedFindings.length;
	/** @type {Map<string, any>} */
	const byFingerprint = new Map();

	for (const { team, finding } of taggedFindings) {
		const fp = computeFingerprint(finding);
		const origin = { team, id: finding.id };

		if (!byFingerprint.has(fp)) {
			byFingerprint.set(fp, {
				...finding,
				team,
				fingerprint: fp,
				merged_from: [origin],
				severity: Number.isInteger(finding.severity) ? finding.severity : 0,
			});
			continue;
		}

		const existing = byFingerprint.get(fp);
		const rep = pickRepresentative(existing, finding);
		const maxSeverity = Math.max(
			existing.severity,
			Number.isInteger(finding.severity) ? finding.severity : 0,
		);
		byFingerprint.set(fp, {
			// 代表 finding の本文を採用しつつ、team / fingerprint / merged_from / severity を維持
			...(rep === existing ? existing : { ...finding, team }),
			fingerprint: fp,
			severity: maxSeverity,
			merged_from: [...existing.merged_from, origin],
		});
	}

	const merged = [...byFingerprint.values()];
	return {
		merged,
		inputCount,
		mergedCount: merged.length,
		duplicatesRemoved: inputCount - merged.length,
	};
}
