#!/usr/bin/env node
/**
 * Phase 1.1 POC — 6 Layer Stack LLM Judge FP 圧縮 POC CLI entry (Issue #2711 / Round 18 frontier 突破挑戦)
 *
 * Usage:
 *   node scripts/ai-evaluation/phase1/run-phase1-poc.mjs --mock --type activity-pack --runs 3
 *   node scripts/ai-evaluation/phase1/run-phase1-poc.mjs --type activity-pack --runs 3   (実 API、cost $25-65)
 *   node scripts/ai-evaluation/phase1/run-phase1-poc.mjs --help
 *
 * 構成: C5 (全 6 layer = Self-Consistency + Multi-Agent Debate + Refute-or-Promote +
 *           Constitutional + Synthetic HE + Judge's Verdict calibration)
 *
 * SSOT:
 *   - tmp/round18-phase1-poc-design-2026-05-30.md (1742 行 step-by-step protocol)
 *   - tmp/round18-phase1-fp-research-2026-05-30.md (1196 行 6 手法 deep research)
 *   - scripts/ai-evaluation/phase1/README.md (本 dir 使い方)
 *
 * 認識バイアス -20% 補正前提: Mock smoke pass = 必要条件のみ、十分条件 (5 軸実測達成) は別 step。
 */

import { existsSync, promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runPipeline } from './lib/pipeline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..'); // worktree root
const OUTPUT_DIR = resolve(ROOT, 'tmp', 'round18-poc');

/**
 * CLI args 解析
 */
function parseCliArgs() {
	const { values } = parseArgs({
		options: {
			type: { type: 'string', default: 'activity-pack' },
			runs: { type: 'string', default: process.env.AI_EVAL_RUNS || '3' },
			model: { type: 'string', default: process.env.AI_EVAL_MODEL || 'claude-opus-4-7' },
			mock: { type: 'boolean', default: false }, // mock smoke test (cost $0)
			'mock-runs': { type: 'string', default: '3' },
			'screenshots-dir': { type: 'string', default: '' }, // optional 既存 SS の dir 上書き
			help: { type: 'boolean', short: 'h', default: false },
		},
		allowPositionals: false,
	});
	return values;
}

function printHelp() {
	console.log(`
Phase 1.1 POC — 6 Layer Stack LLM Judge FP 圧縮 POC CLI (Issue #2711)

Usage:
  node scripts/ai-evaluation/phase1/run-phase1-poc.mjs [options]

Options:
  --type <name>          評価対象 type (default: activity-pack、POC scope は 1 type)
  --runs <N>             Self-Consistency runs (default: 3、POC naive。Phase 1.2 で 5-10 runs upgrade)
  --model <name>         Claude model (default: claude-opus-4-7)
  --mock                 Mock mode: 実 Anthropic / Gemini API call なし、cost $0
                         realistic dummy response で 6 layer pipeline structural 健全性のみ検証
  --mock-runs <N>        Mock 時の Self-Consistency runs 数 (default: 3)
  --screenshots-dir <P>  既存 SS dir を流用 (default: 内部で stub fixture を生成)
  --help, -h             ヘルプ表示

Mode 別 cost 試算:
  --mock        : $0 (Mock smoke test、本 PR 範囲、AC1-AC2)
  Real (未指定) : $25-65 (実 Claude Opus 4.7 + Gemini 2.5 Pro Cross-Model Critic、AC3 別 step)

達成判定 5 軸 (AC4、実 API 実行後):
  (a) Recall ≥ 70%
  (b) Precision ≥ 80% (FP ≤ 20%) ★ 主目標
  (c) FN ≤ 30%
  (d) Cohen's Kappa ≥ 0.50
  (e) User filter ≤ 30 分 / type

Prerequisite (--mock 不使用時、AC3 別 step):
  - .env.local に ANTHROPIC_API_KEY + GEMINI_API_KEY を配備
  - demo Lambda env を別 terminal で起動:
      AUTH_MODE=anonymous DATA_SOURCE=demo npm run preview -- --port 5180

Examples:
  # AC2: Mock smoke test (本 PR 範囲、cost $0)
  node scripts/ai-evaluation/phase1/run-phase1-poc.mjs --mock --type activity-pack --runs 3

  # AC3: 実 API (User 承認後 opt-in、cost $25-65)
  node scripts/ai-evaluation/phase1/run-phase1-poc.mjs --type activity-pack --runs 3

SSOT:
  - tmp/round18-phase1-poc-design-2026-05-30.md (1742 行 step-by-step protocol + 実装可能 prompt template)
  - tmp/round18-phase1-fp-research-2026-05-30.md (1196 行 6 手法 deep research + Pareto front C3/C4/C5)
  - scripts/ai-evaluation/phase1/README.md (本 dir 使い方 + Mock vs Real cost 試算)

認識バイアス -20% 補正: 達成可能性 50-60% は -20% 補正で 40-48%、達成不可能性 52-60% 視野。
  technical 達成 (Mock pass / Pipeline 動作) ≠ User goal (Phase 1-4 完成で User filter 撤廃) を honest 区別。
`);
}

async function ensureDir(dir) {
	if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true });
}

async function main() {
	const args = parseCliArgs();
	if (args.help) {
		printHelp();
		return;
	}

	const runs = Number.parseInt(args.mock ? args['mock-runs'] : args.runs, 10);
	if (!Number.isFinite(runs) || runs < 1) {
		console.error(`[run-phase1-poc] runs invalid: ${args.runs}`);
		process.exit(1);
	}

	const mode = args.mock ? 'MOCK' : 'REAL';
	console.log(`[run-phase1-poc] mode=${mode} type=${args.type} runs=${runs} model=${args.model}`);

	if (mode === 'REAL') {
		// API key 配備 check (real mode のみ)
		if (!process.env.ANTHROPIC_API_KEY) {
			console.error(
				`[run-phase1-poc] FATAL: ANTHROPIC_API_KEY 未配備。.env.local に配備するか --mock で起動してください。`,
			);
			process.exit(1);
		}
		if (!process.env.GEMINI_API_KEY) {
			console.warn(
				`[run-phase1-poc] WARN: GEMINI_API_KEY 未配備。Layer C Stage D (Cross-Model Critic) は skip されます。`,
			);
		}
	}

	await ensureDir(OUTPUT_DIR);

	const outputPath = resolve(
		OUTPUT_DIR,
		`${mode === 'MOCK' ? 'mock-' : ''}evaluation-c5-${args.type}.json`,
	);

	// 6 layer pipeline 実行
	const result = await runPipeline({
		type: args.type,
		runs,
		model: args.model,
		mock: args.mock,
		anthropicApiKey: process.env.ANTHROPIC_API_KEY,
		geminiApiKey: process.env.GEMINI_API_KEY,
		screenshotsDir: args['screenshots-dir'] || undefined,
	});

	await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
	console.log(`[run-phase1-poc] DONE: ${outputPath}`);
	console.log(`[run-phase1-poc] summary:`, JSON.stringify(result.summary, null, 2));

	if (mode === 'MOCK') {
		console.log(`\n[run-phase1-poc] Mock smoke test 完了。技術達成 (必要条件) のみ。`);
		console.log(
			`[run-phase1-poc] 次 step: User 承認後、実 API (AC3 / cost $25-65) で 5 軸定量実測実施`,
		);
	}
}

main().catch((err) => {
	console.error(`[run-phase1-poc] FATAL:`, err);
	process.exit(1);
});
