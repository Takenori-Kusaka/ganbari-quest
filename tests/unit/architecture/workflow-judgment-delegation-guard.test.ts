/**
 * tests/unit/architecture/workflow-judgment-delegation-guard.test.ts (#4158)
 *
 * 「**同じ検査が workflow YAML と scripts/*.mjs の 2 箇所にある**」を機械で禁じる。
 *
 * ## 何が起きていたか
 *
 * `pre-ready --help` は Step 11b を「CI `screenshot-check` と SSOT 共有」と書いていたが、
 * 実際の `screenshot-check` は同じ .mjs から 2 関数しか import しておらず、
 * **SS embed の有無判定は inline 正規表現**だった。両者は等価ではない:
 *
 *   script  `hasEmbeddedScreenshotImage(body)` … URL を抽出し http(s) かつ screenshot/attachment URL を要求
 *   inline  `/!\[.*?\]\(.*?\)|<img\s/i`        … `![](...)` が 1 個あれば pass
 *
 * → `![](tmp/local.png)` だけの PR は **CI 緑・pre-ready 赤**。
 * → 逆向きは #4153 で実発生（`ss-render-impossible` を .mjs にだけ実装 → pre-ready 緑・CI 赤）。
 *
 * **本質は「検査が多すぎて漏れた」ではなく「同じ検査が 2 箇所にあり、片方だけ直せば必ずズレる」。**
 * 本数を減らしても二重実装が残る限り同じ事故が起きる。だから減らすのではなく等価性を機械で固定する
 * (ADR-0061 same-class-N→guard)。
 *
 * ## 本 test が固定すること
 *
 *   [D1] 母数 — 対象 workflow の全 job が registry に宣言されている（未宣言 = 検査から静かに消える）
 *   [D2] stale — registry に在るのに実在しない workflow / job を宣言していない
 *   [D3] delegation='script' の job は、宣言した module を実際に import している
 *   [D4] delegation='script' の job は、宣言した export を実際に呼んでいる
 *   [D5] **inline 判定の再混入禁止** — 委譲済 job の `script:` に、委譲したはずの判定の
 *        既知アンチパターン（生の正規表現による画像検出 / label 名の直書き）が無い
 *   [D6] registry の記述品質 — `reason` 空文字禁止 / `not-required` は追跡 Issue 必須
 *
 * ## 走査方針
 *
 * 判定は **parse 済み YAML の `run` / `with.script` にだけ**当てる。workflow 全文 grep だと
 * コメントや案内文言（「スクリーンショットを添付してください」等）を誤検出する
 * (`pr-trigger-lane-guard.test.ts` の同注意書きと同じ理由)。
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import * as yaml from 'yaml';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。区分は
// scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

import {
	COVERED_WORKFLOWS,
	WORKFLOW_JUDGMENTS,
	findJudgment,
} from '../../../scripts/lib/ci/workflow-judgment-registry.mjs';

const WORKFLOW_DIR = path.join(process.cwd(), '.github', 'workflows');

/** workflow を parse し、job id → 全 step の「実行文字列」配列 を返す。 */
function jobScriptsOf(workflowFile: string): Map<string, string[]> {
	const raw = readFileSync(path.join(WORKFLOW_DIR, workflowFile), 'utf-8');
	const doc = yaml.parse(raw) as { jobs?: Record<string, { steps?: unknown[] }> };
	const result = new Map<string, string[]>();

	for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
		const texts: string[] = [];
		for (const rawStep of job?.steps ?? []) {
			if (rawStep === null || typeof rawStep !== 'object') continue;
			const step = rawStep as { run?: unknown; with?: { script?: unknown } };
			if (typeof step.run === 'string') texts.push(step.run);
			// actions/github-script の判定本体は with.script に入る
			if (typeof step.with?.script === 'string') texts.push(step.with.script);
		}
		result.set(jobId, texts);
	}
	return result;
}

/** 実在する workflow file 一覧 (母数を registry から取らない)。 */
function listWorkflowFiles(): string[] {
	return readdirSync(WORKFLOW_DIR)
		.filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
		.sort();
}

describe('#4158 合否判定を workflow YAML に書かない', () => {
	it('[D0] 母数: 対象 workflow が実在し、job を 1 つ以上持つ', () => {
		// 0 件なら「全部通った」ではなく「1 つも検査していない」。
		expect(COVERED_WORKFLOWS.length).toBeGreaterThan(0);
		const files = listWorkflowFiles();
		for (const wf of COVERED_WORKFLOWS) {
			expect(files, `${wf} が .github/workflows に無い`).toContain(wf);
			expect(jobScriptsOf(wf).size, `${wf} の job 数`).toBeGreaterThan(0);
		}
	});

	it('[D1] 対象 workflow の全 job が registry に宣言されている (no-silent-gap)', () => {
		const undeclared: string[] = [];
		for (const wf of COVERED_WORKFLOWS) {
			for (const jobId of jobScriptsOf(wf).keys()) {
				if (!findJudgment(wf, jobId)) undeclared.push(`${wf}:${jobId}`);
			}
		}
		expect(
			undeclared,
			`registry 未宣言の job: ${undeclared.join(' / ')}。` +
				'scripts/lib/ci/workflow-judgment-registry.mjs に delegation と reason を足すこと。' +
				'宣言しないまま job を足すと、判定が YAML に戻っても誰も気づかない (#4158)',
		).toEqual([]);
	});

	it('[D2] registry に stale な宣言が無い', () => {
		const stale: string[] = [];
		for (const d of WORKFLOW_JUDGMENTS) {
			const jobs = listWorkflowFiles().includes(d.workflow)
				? jobScriptsOf(d.workflow)
				: new Map<string, string[]>();
			if (!jobs.has(d.job)) stale.push(`${d.workflow}:${d.job}`);
		}
		expect(stale, `実在しない workflow / job の宣言: ${stale.join(' / ')}`).toEqual([]);
	});

	describe('[D3][D4] delegation=script は宣言どおり委譲している', () => {
		for (const d of WORKFLOW_JUDGMENTS.filter((x) => x.delegation === 'script')) {
			it(`${d.workflow}:${d.job} が ${d.module} を参照している`, () => {
				const texts = jobScriptsOf(d.workflow).get(d.job) ?? [];
				const joined = texts.join('\n');
				const moduleBase = path.basename(d.module ?? '');
				expect(
					joined,
					`${d.job} が ${d.module} を参照していない。registry の宣言が実態と違う`,
				).toContain(moduleBase);
			});

			for (const fn of d.functions ?? []) {
				it(`${d.workflow}:${d.job} が ${fn} を呼んでいる`, () => {
					const joined = (jobScriptsOf(d.workflow).get(d.job) ?? []).join('\n');
					// import しただけで呼んでいない = 判定が別の場所にある。
					expect(
						new RegExp(`\\b${fn}\\s*\\(`).test(joined),
						`${d.job} が ${fn}( を呼んでいない。inline 判定が残っている可能性がある`,
					).toBe(true);
				});
			}
		}
	});

	describe('[D5] 委譲済 job に inline 判定を書き戻していない', () => {
		// 既知のアンチパターン。**「判定に見える文字列」ではなく「過去に実在した inline 判定の形」**を
		// 列挙する。網羅ではなく回帰 guard (#4158 で実際に外した 3 つの形)。
		const REGRESSION_PATTERNS: { pattern: RegExp; what: string; delegateTo: string }[] = [
			{
				pattern: /!\\\[.*?\\\]\\\(.*?\\\)\s*\|\s*<img/,
				what: '画像 embed の有無を生の正規表現で判定している',
				delegateTo: 'hasEmbeddedScreenshotImage()',
			},
			{
				pattern: /['"`]refactor:internal-no-doc-impact['"`]/,
				what: 'exempt label 名を YAML に直書きしている',
				delegateTo: 'INTERNAL_REFACTOR_LABEL / hasInternalRefactorLabel()',
			},
			{
				pattern: /\/\\\.\(svelte\|/,
				what: 'UI 変更ファイルの判定を生の正規表現で書いている',
				delegateTo: 'isUiPr()',
			},
		];

		for (const d of WORKFLOW_JUDGMENTS.filter((x) => x.delegation === 'script')) {
			it(`${d.workflow}:${d.job}`, () => {
				const joined = (jobScriptsOf(d.workflow).get(d.job) ?? []).join('\n');
				const hits = REGRESSION_PATTERNS.filter((p) => p.pattern.test(joined)).map(
					(p) => `${p.what} → ${p.delegateTo} に委譲する`,
				);
				expect(hits, hits.join(' / ')).toEqual([]);
			});
		}
	});

	it('[D6] registry の記述品質 — reason 必須 / not-required は追跡 Issue 必須', () => {
		const violations: string[] = [];
		for (const d of WORKFLOW_JUDGMENTS) {
			const id = `${d.workflow}:${d.job}`;
			if (!d.reason || d.reason.trim().length < 10) {
				violations.push(`${id}: reason が空か短すぎる (理由の非強制を作らない)`);
			}
			if (d.delegation === 'script' && !d.module) {
				violations.push(`${id}: delegation='script' なのに module が無い`);
			}
			if (d.delegation === 'expression' && !d.ssot) {
				violations.push(`${id}: delegation='expression' なのに ssot が無い`);
			}
			if (d.delegation === 'not-required' && !/#\d+/.test(d.issue ?? '')) {
				violations.push(`${id}: delegation='not-required' なのに追跡 Issue が無い`);
			}
		}
		expect(violations, violations.join('\n')).toEqual([]);
	});
});
