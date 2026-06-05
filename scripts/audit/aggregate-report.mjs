/**
 * scripts/audit/aggregate-report.mjs (EPIC #2861 / B4 = #2867)
 *
 * 集約レポート (`tmp/audit-run-<date>.md`) の markdown を組み立てる pure function。
 * AC4 のログ形式 = finding 件数 / 重複統合後 / 棄却 (severity 未満 backlog) /
 * 起票候補件数 を人間可読に出力する (audit-team.md §3.6 / audit-manager.md §E)。
 *
 * 本 module は markdown 文字列を返すのみ (file write は run-pipeline.mjs 側)。
 * vitest: tests/unit/audit/aggregate-report.test.ts
 */

/** @param {any} f */
function fmtFindingRow(f) {
	const sev = Number.isInteger(f?.severity) ? f.severity : '?';
	const team = f?.team ?? '?';
	const rule = f?.ruleId ?? '?';
	const title = (f?.title ?? '').replace(/\|/g, '\\|');
	const loc = (f?.location ?? '').replace(/\|/g, '\\|');
	const mergedCount = Array.isArray(f?.merged_from) ? f.merged_from.length : 1;
	return `| ${f?.id ?? '?'} | ${team} | ${rule} | ${sev} | ${mergedCount} | ${title} | ${loc} |`;
}

/**
 * 集約レポート markdown を組み立てる。
 *
 * @param {object} input
 * @param {string} input.runId run 識別子 (`<pr>-<YYYYMMDD>` または `baseline-<YYYYMMDD>`)
 * @param {string} input.scope `baseline` | `integration`
 * @param {number} input.integrationPr 統合 PR 番号 (baseline は 0)
 * @param {string} input.generatedAt ISO 8601 UTC
 * @param {object} input.stats
 * @param {number} input.stats.rawFindingCount       全件発露の総数
 * @param {number} input.stats.mergedCount           重複統合後件数
 * @param {number} input.stats.duplicatesRemoved     統合で消えた重複数
 * @param {number} input.stats.escalatedCount        severity 3-4 (起票候補 = 次段へ)
 * @param {number} input.stats.backlogCount          severity 1-2 (backlog 蓄積のみ)
 * @param {Array<string>} input.rejectedEvidence     schema 不充足 / URL 欠落で自動棄却した記録
 * @param {Array<object>} input.escalated            severity 3-4 finding 配列
 * @param {Array<object>} input.backlog              severity 1-2 finding 配列
 * @returns {string} markdown
 */
export function buildAggregateReport(input) {
	const { runId, scope, integrationPr, generatedAt, stats, rejectedEvidence, escalated, backlog } =
		input;

	const lines = [];
	lines.push(`# 監査 run 集約レポート — ${runId}`);
	lines.push('');
	lines.push(
		'> EPIC #2861 / B4 = #2867 — finding pipeline (全件発露 → 重複統合 → severity filter) の機械集約結果。',
	);
	lines.push(
		'> ポリシー準拠 filter (LLM 判定) と起票実行は audit-manager orchestrator が本レポートを受けて実施する',
	);
	lines.push(
		'> (audit-team.md §3.6 / audit-manager.md §E)。本ファイルは CI / pipeline が生成する rules-based 集約のみ。',
	);
	lines.push('');
	lines.push('## メタ');
	lines.push('');
	lines.push('| 項目 | 値 |');
	lines.push('|---|---|');
	lines.push(`| run_id | ${runId} |`);
	lines.push(`| scope | ${scope} |`);
	lines.push(
		`| integration_pr | ${integrationPr === 0 ? '0 (baseline / 差分非依存)' : `#${integrationPr}`} |`,
	);
	lines.push(`| generated_at | ${generatedAt} |`);
	lines.push('');
	lines.push('## 件数サマリ (AC4 ログ形式)');
	lines.push('');
	lines.push('| 指標 | 件数 |');
	lines.push('|---|---|');
	lines.push(`| 全件発露 (raw findings) | ${stats.rawFindingCount} |`);
	lines.push(`| 重複統合後 | ${stats.mergedCount} |`);
	lines.push(`| 重複統合で除去 | ${stats.duplicatesRemoved} |`);
	lines.push(`| 起票候補 (severity 3-4 → 次段 policy filter へ) | ${stats.escalatedCount} |`);
	lines.push(`| backlog 蓄積のみ (severity 1-2) | ${stats.backlogCount} |`);
	lines.push(`| 自動棄却 (schema 不充足 / URL 欠落) | ${rejectedEvidence.length} |`);
	lines.push('');

	lines.push('## 起票候補 (severity 3-4 — ポリシー準拠 filter 未通過)');
	lines.push('');
	lines.push(
		'> 以下は **起票確定ではない**。audit-manager が policy-compliance skill で誤起票 filter を',
	);
	lines.push(
		'> 通し、`policy_compliant=false` のもののみを issue-triage 経由で起票する (audit-team.md §3.6 [4][5])。',
	);
	lines.push('');
	if (escalated.length === 0) {
		lines.push('_(該当なし)_');
	} else {
		lines.push('| id | team | ruleId | severity | 統合数 | title | location |');
		lines.push('|---|---|---|---|---|---|---|');
		for (const f of escalated) lines.push(fmtFindingRow(f));
	}
	lines.push('');

	lines.push('## backlog (severity 1-2 — 蓄積のみ、起票しない)');
	lines.push('');
	if (backlog.length === 0) {
		lines.push('_(該当なし)_');
	} else {
		lines.push('| id | team | ruleId | severity | 統合数 | title | location |');
		lines.push('|---|---|---|---|---|---|---|');
		for (const f of backlog) lines.push(fmtFindingRow(f));
	}
	lines.push('');

	lines.push('## 自動棄却 (無言棄却しない — 理由を記録)');
	lines.push('');
	if (rejectedEvidence.length === 0) {
		lines.push('_(該当なし)_');
	} else {
		for (const r of rejectedEvidence) lines.push(`- ${r}`);
	}
	lines.push('');

	return lines.join('\n');
}
