/**
 * scripts/audit/evaluate-merge-readiness.mjs (Issue #2876 — Phase B/B-4、親 #2949 / EPIC #2861)
 *
 * 統合 PR の「マージ判定 advisory 評価」を行う pure function。
 * NG-0 (severity 3-4 + policy_compliant=false が 0) + カバレッジ ratchet 閾値達成を rules-based で
 * 評価し、judgement (pass/fail) + 理由を返す。
 *
 * **位置づけ: advisory (先行)**。本評価は ci.yml `integration-evidence` job (PR 時) で
 * `continue-on-error` step として実行し、結果を job summary + evidence.md に出すだけで **hard fail
 * させない**。required_status_checks にも登録しない。required 昇格は別 Issue / 段階導入
 * (deploy-aws-staging.yml 先例 = runbooks/staging-gate-required-checks.md 同型) で行う。
 * 理由: ライブ統合 PR の merge を本評価の偽陽性 / 前提未整備で阻害しないため (Issue #2876 設計判断)。
 *
 * NG の正本判定 (severity 3-4 + policy_compliant=false の最終確定) は audit-manager run が
 * 統合 PR body §3 に記入する人間判定であり、本 advisory は CI が機械集約できる SARIF level /
 * job 結果 / coverage の機械スナップショットに限る (EPIC 設計原則 1 — LLM 判定を hard gate に
 * 昇格しない / hard gate は rules-based のみ)。
 *
 * 本 module は副作用を持たない。
 * vitest unit test: tests/unit/audit/evaluate-merge-readiness.test.ts
 *
 * 関連:
 *   - scripts/audit/severity-filter.mjs (SEVERITY_ESCALATION_THRESHOLD を再利用)
 *   - scripts/audit/to-sarif.mjs (SARIF level の意味)
 *   - docs/sessions/audit-team.md §3.5 (マージ判定エビデンス基準)
 */

import { SEVERITY_ESCALATION_THRESHOLD } from './severity-filter.mjs';

/**
 * SARIF result 群 (または finding 群) から、NG とみなす severity 3-4 相当の件数を数える (pure)。
 * SARIF result の level==='error' (= severity 3-4 写像) を NG 候補とする。
 * finding 形式 (severity 数値 + policy_compliant) も受け、severity>=3 かつ policy_compliant!==true を NG とする。
 *
 * @param {Array<any>} items SARIF results または finding 配列
 * @returns {{ ngCount: number, ngItems: Array<any> }}
 */
export function countNg(items) {
	/** @type {Array<any>} */
	const ngItems = [];
	for (const it of items ?? []) {
		// finding 形式: severity 数値 + policy_compliant boolean
		if (Number.isInteger(it?.severity)) {
			const isPolicyCompliant = it.policy_compliant === true;
			if (it.severity >= SEVERITY_ESCALATION_THRESHOLD && !isPolicyCompliant) {
				ngItems.push({
					ruleId: it.ruleId,
					reason: `severity ${it.severity} >= ${SEVERITY_ESCALATION_THRESHOLD} かつ policy_compliant != true`,
				});
			}
			continue;
		}
		// SARIF result 形式: level==='error' を NG 候補とする
		if (it?.level === 'error') {
			ngItems.push({ ruleId: it.ruleId, reason: 'SARIF level=error' });
		}
	}
	return { ngCount: ngItems.length, ngItems };
}

/**
 * coverage gap map (generate-coverage-gap-map.mjs `buildCoverageGapMap` の出力) から ratchet 閾値
 * 割れの有無を判定する (pure)。gap map の実形は { total: { lines: { pct } }, zeroCoverageFiles: [] }。
 * - zeroCoverageFiles (= test から一切参照されない src) が 1 件以上 → ratchet 割れ
 * - lineThreshold 指定時は total.lines.pct < lineThreshold も ratchet 割れ
 * gap map が null (coverage 未取得) のときは「未取得 = 評価不能」を warn として扱い ratchetOk=null。
 *
 * @param {{ total?: { lines?: { pct?: number } } | null, zeroCoverageFiles?: Array<string> } | null} coverageGapMap
 * @param {{ lineThreshold?: number }} [opts]
 * @returns {{ ratchetOk: boolean | null, belowThresholdCount: number, totalLinePct: number | null }}
 */
export function evaluateCoverageRatchet(coverageGapMap, opts = {}) {
	if (coverageGapMap == null) {
		return { ratchetOk: null, belowThresholdCount: 0, totalLinePct: null };
	}
	const zeroCount = Array.isArray(coverageGapMap.zeroCoverageFiles)
		? coverageGapMap.zeroCoverageFiles.length
		: 0;
	const totalLinePct =
		typeof coverageGapMap.total?.lines?.pct === 'number' ? coverageGapMap.total.lines.pct : null;

	let belowThreshold = false;
	if (typeof opts.lineThreshold === 'number' && totalLinePct !== null) {
		belowThreshold = totalLinePct < opts.lineThreshold;
	}

	const ratchetOk = zeroCount === 0 && !belowThreshold;
	return {
		ratchetOk,
		belowThresholdCount: zeroCount + (belowThreshold ? 1 : 0),
		totalLinePct,
	};
}

/**
 * 統合 PR の advisory マージ判定を評価する (pure)。
 *
 * - ngCount === 0 (severity 3-4 + policy_compliant=false が 0) かつ
 * - coverage ratchet 割れなし (ratchetOk === true。未取得 null は「評価不能」で advisory pass を出さない)
 * - 全 job 緑 (allGreen === true)
 * を満たすと advisory pass。1 つでも欠ければ advisory fail (ただし hard fail させない = 呼び出し側 step が continue-on-error)。
 *
 * @param {{
 *   sarifResults?: Array<any>,
 *   findings?: Array<any>,
 *   coverageGapMap?: any,
 *   allGreen?: boolean,
 * }} input
 * @returns {{
 *   advisoryPass: boolean,
 *   ngCount: number,
 *   ngItems: Array<{ ruleId?: string, reason: string }>,
 *   coverageRatchetOk: boolean | null,
 *   coverageBelowThresholdCount: number,
 *   allGreen: boolean,
 *   reasons: string[],
 * }}
 */
export function evaluateMergeReadiness({
	sarifResults = [],
	findings = [],
	coverageGapMap = null,
	allGreen = false,
} = {}) {
	// finding を優先評価 (severity + policy_compliant)、無ければ SARIF results (level)。
	const items = (findings?.length ?? 0) > 0 ? findings : sarifResults;
	const ng = countNg(items);
	const cov = evaluateCoverageRatchet(coverageGapMap);

	const reasons = [];
	if (ng.ngCount > 0) reasons.push(`NG ${ng.ngCount} 件 (severity 3-4 + policy_compliant=false)`);
	if (cov.ratchetOk === false) reasons.push(`coverage ratchet 割れ ${cov.belowThresholdCount} 件`);
	if (cov.ratchetOk === null) reasons.push('coverage 未取得 (評価不能 = advisory pass を出さない)');
	if (allGreen !== true) reasons.push('最重厚レーン全 job が緑でない');

	const advisoryPass = ng.ngCount === 0 && cov.ratchetOk === true && allGreen === true;

	return {
		advisoryPass,
		ngCount: ng.ngCount,
		ngItems: ng.ngItems,
		coverageRatchetOk: cov.ratchetOk,
		coverageBelowThresholdCount: cov.belowThresholdCount,
		allGreen: allGreen === true,
		reasons: advisoryPass ? ['NG 0 + coverage ratchet 達成 + 全 job 緑 (advisory pass)'] : reasons,
	};
}

/**
 * advisory 評価結果を markdown サマリに整形する (pure)。
 * evidence.md §3 への差込 / job summary 用。**advisory である旨を明示**する。
 *
 * @param {ReturnType<typeof evaluateMergeReadiness>} result
 * @returns {string}
 */
export function formatMergeReadinessMarkdown(result) {
	const status = result.advisoryPass ? '✅ advisory PASS' : '⚠️ advisory FAIL';
	const lines = [
		'### マージ判定 advisory 評価 (#2876、hard fail させない先行 gate)',
		'',
		`- 判定: ${status}`,
		`- NG 件数 (severity 3-4 + policy_compliant=false): ${result.ngCount}`,
		`- coverage ratchet: ${result.coverageRatchetOk === null ? '未取得 (評価不能)' : result.coverageRatchetOk ? '閾値内' : `割れ ${result.coverageBelowThresholdCount} 件`}`,
		`- 最重厚レーン全 job 緑: ${result.allGreen}`,
		'',
		`> 本評価は **advisory (先行)** であり merge を block しない (required_status_checks 未登録、`,
		`> continue-on-error)。NG の最終確定は audit-manager run が統合 PR body §3 に記入する人間判定が正本。`,
		`> required 昇格は別 Issue / 段階導入で判断する (deploy-aws-staging.yml 先例同型)。`,
	];
	if (!result.advisoryPass) {
		lines.push('', '理由:', ...result.reasons.map((r) => `- ${r}`));
	}
	return lines.join('\n');
}
