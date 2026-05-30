/**
 * User filter session markdown 出力 module (Issue #2692 AC7)
 *
 * tmp/round18-review-activity-pack-<date>.md として出力。
 * User が browser でテキスト編集して filter する base file (Section 1-4 構成)。
 *
 * SSOT:
 *   - tmp/round18-parallel-path-first-review-plan-2026-05-30.md §6 (wireframe)
 *   - scripts/ai-evaluation/lib/multi-agent-evaluator.mjs (集約 JSON schema)
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 集約 JSON から User filter session markdown を生成
 *
 * Section 1: High Certainty Severity 3-4 (即承認推奨)
 * Section 2: Low Certainty (SS 確認必須)
 * Section 3: User 違和感記録欄
 * Section 4: Submit (Issue 起票 + feedback-log)
 */
export function renderFilterSession(aggregated) {
	const date = aggregated.evaluation_date;
	const type = aggregated.type;
	const ageMode = aggregated.age_mode;
	const summary = aggregated.summary;

	// matrix を high / low certainty + severity でセクション分け
	const highCert = aggregated.matrix.filter((m) => m.certainty >= 0.7);
	const lowCert = aggregated.matrix.filter((m) => m.certainty < 0.3);
	const midCert = aggregated.matrix.filter((m) => m.certainty >= 0.3 && m.certainty < 0.7);

	const highSev34 = highCert.filter((m) => (m.severity ?? 0) >= 3);
	const lowAny = lowCert;

	const mockNote = aggregated.mock_mode
		? `\n> ⚠️ **MOCK mode**: 本 file は realistic dummy data から生成された structural test 出力。\n> Recall / FP / FN / Kappa 等の達成判定 5 軸は実 Claude API 評価 + User filter session を経ないと意味ある数値にならない。\n> 実 Claude API 評価は別 thread で User 判断後実施 (cost $10-30、Issue #2693)。\n`
		: '';

	let md = `# 並走 path Review Filter — ${type} × ${ageMode} (${date})

> AI 評価日時: ${date} / User filter 推定所要時間: 15-30 分
> Stack: Stagehand v3 + Claude Opus (${aggregated.model}) + axe-core + Self-Consistency ${aggregated.self_consistency_runs} runs
> Issue #2692 / EPIC #2691 POC 出力${mockNote}

## 集約サマリ

- Total issues detected: ${summary.total_issues} 件
- Severity 3-4: ${summary.severity_3_4_count} 件 (顧客 review BLOCK 候補)
- High certainty (>0.7) Role: ${summary.high_certainty_count} / 5
- Low certainty (<0.3) Role: ${summary.low_certainty_count} / 5 (filter 重点)
- False positive estimate: ${summary.false_positive_estimate_pct}

---

## Section 1: High Certainty Severity 3-4 (即承認 推奨、推定 5-10 分)

`;

	if (highSev34.length === 0) {
		md +=
			'_該当なし (3 runs 一致の severity 3-4 検出 0 件)。Low certainty を重点確認してください。_\n';
	} else {
		highSev34.forEach((item, i) => {
			md += `### [✓ Issue #${i + 1}] Step ${item.step} — ${item.heuristic_or_question}

- **Agent**: ${item.agent} (certainty=${item.certainty.toFixed(2)})
- **Severity**: ${item.severity} / **Result**: ${item.result}
- **Evidence**: ${item.evidence || '_(未記載)_'}
- [ ] Yes 承認 (顧客 review BLOCK)
- [ ] No 却下 (False Positive)
- [ ] 後で確認

`;
		});
	}

	md += `---

## Section 2: Low Certainty (SS 確認 必須、推定 5-10 分)

`;

	if (lowAny.length === 0) {
		md += '_該当なし (全 Role が 0.3 以上の certainty で安定検出)。_\n';
	} else {
		lowAny.slice(0, 15).forEach((item, i) => {
			md += `### [? Issue #${i + 1}] Step ${item.step} — ${item.heuristic_or_question}

- **Agent**: ${item.agent} (certainty=${item.certainty.toFixed(2)}、3 runs 中 ${Math.round(item.certainty * aggregated.self_consistency_runs)} 件のみ検出)
- **Severity**: ${item.severity} / **Result**: ${item.result}
- **Evidence**: ${item.evidence || '_(未記載)_'}
- [ ] AI 正
- [ ] AI 誤
- [ ] 部分的に正
- [ ] 判定保留

`;
		});
		if (lowAny.length > 15) {
			md += `\n_(残 ${lowAny.length - 15} 件は省略、JSON file の matrix を直接確認してください)_\n\n`;
		}
	}

	// Mid certainty (参考表示)
	if (midCert.length > 0) {
		md += `---

## Section 2b: Mid Certainty 参考 (${midCert.length} 件)

詳細は \`tmp/round18/evaluation-${type}-${ageMode}.json\` の matrix を確認してください。

`;
	}

	md += `---

## Section 3: User 違和感記録欄 (推定 5-10 分)

> AI が見落としている可能性のある問題を 0-5 件記録 (任意)

- [ ] 用語が不統一
- [ ] dead-end (操作後に何も起きない)
- [ ] 想定外の挙動
- [ ] その他

(空欄、User が browser でテキスト編集)

---

## Section 4: Submit

完了後、以下を実行 (User 承認後):

1. severity 3-4 で \`Yes 承認\` 項目 → \`gh issue create\` で本 product Issue 起票 (label: \`cx-review\`, \`marketplace-import\`)
2. severity 1-2 → \`tmp/round18-feedback-log.md\` に追記 (cross-type 学習素材)
3. 次 type review (reward-set) を起動 (Stagehand script 再実行 + prompt context に過去 feedback inject)

---

## 達成判定 5 軸 (Round 17 §0.3 / Issue #2693 で実測)

| 軸 | 閾値 | 本 session 実測値 |
|---|---|---|
| (a) AI 検出 true positive 率 (Recall) | ≥ 70% | _(User filter 後に算出)_ |
| (b) AI 見落とし率 (FN) | ≤ 25% | _(Section 3 件数で算出)_ |
| (c) AI 過剰検出率 (FP) | ≤ 35% | _(Section 1 No 却下件数 / 総 issue)_ |
| (d) Cohen's Kappa (severity AI vs User) | ≥ 0.50 | _(filter 完了後に算出)_ |
| (e) User 立ち会い時間 | ≤ 30 分 / type | _(session 開始/終了時刻記録)_ |

判定 path: 3 件全達成 → sub #N3 (reward-set 展開) / 1-2 件未達 → Round 18.5 fallback / 3+ 件未達 → Stack 振り出し判断

---

## 関連 SSOT

- \`tmp/round18/evaluation-${type}-${ageMode}.json\` (raw AI evaluation 集約 JSON)
- \`tmp/round18/ss-${ageMode}-step{1-5}.png\` (Stagehand 撮影 SS)
- \`tmp/round18/axe-${ageMode}-step{3}.json\` (axe-core report)
- \`tmp/round18-parallel-path-first-review-plan-2026-05-30.md\` (本 session の作業手順 SSOT)
- \`scripts/ai-evaluation/README.md\` (POC 全体使い方)
`;

	return md;
}

/**
 * filter session markdown を保存
 */
export async function saveFilterSession(mdPath, aggregated) {
	await fs.mkdir(dirname(mdPath), { recursive: true });
	const md = renderFilterSession(aggregated);
	await fs.writeFile(mdPath, md, 'utf-8');
}
