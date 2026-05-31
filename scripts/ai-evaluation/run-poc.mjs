#!/usr/bin/env node
// @ts-nocheck — Pre-PMF POC: .mjs jsdoc 型整備は別 follow-up Issue (#2695 scope 外)
/**
 * AI Heuristic Evaluator POC entry point (Issue #2692 / EPIC #2691)
 *
 * Usage:
 *   node scripts/ai-evaluation/run-poc.mjs --type activity-pack --age preschool
 *   node scripts/ai-evaluation/run-poc.mjs --type activity-pack --age all
 *   node scripts/ai-evaluation/run-poc.mjs --help
 *
 * Prerequisite:
 *   1. .env.local に ANTHROPIC_API_KEY (https://console.anthropic.com/settings/keys 取得)
 *   2. 別 terminal で demo Lambda env を起動:
 *        AUTH_MODE=anonymous DATA_SOURCE=demo npm run preview -- --port 5180
 *   3. 5 fixture child (901-906) が demo-data.ts SSOT で seeded されている (default で OK)
 *
 * Outputs:
 *   - tmp/round18/ss-<age>-step<N>.png (Stagehand 自動探索 SS、5 age mode × 5 step = 25 枚 + variant)
 *   - tmp/round18/axe-<age>-step<N>.json (axe-core report、25 cycle)
 *   - tmp/round18/evaluation-<type>-<age>.json (Multi-Agent 集約 JSON、5 Role × 3 runs)
 *   - tmp/round18-review-<type>-<date>.md (User filter session markdown、AC7)
 *
 * 期待 cost: $10-30 per type evaluation (Claude Opus 4.7 cache 90% off 前提、5 Role × 3 runs × 5 age mode)
 *
 * SSOT:
 *   - tmp/round18-parallel-path-first-review-plan-2026-05-30.md (作業手順)
 *   - tmp/round18-parallel-path-stack-2026-05-30.md (stack 選定根拠)
 *   - scripts/ai-evaluation/README.md (本 POC 使い方)
 */

import { existsSync, promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runFullAudit } from './lib/axe-runner.mjs';
import { saveFilterSession } from './lib/filter-session-renderer.mjs';
import { evaluateWithMultiAgent, saveEvaluation } from './lib/multi-agent-evaluator.mjs';
import {
	ACTIVITY_PACK_FLOW,
	AGE_MODES,
	closeStagehand,
	createStagehand,
	executeStep,
	FIXTURE_CHILDREN,
	getActivePage,
	setChildContext,
} from './lib/stagehand-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..'); // worktree root
const OUTPUT_DIR = resolve(ROOT, 'tmp', 'round18');

/**
 * CLI args 解析
 */
function parseCliArgs() {
	const { values } = parseArgs({
		options: {
			type: { type: 'string', default: 'activity-pack' },
			age: { type: 'string', default: 'preschool' }, // 'preschool' | 'all' | 'baby' 等
			runs: { type: 'string', default: process.env.AI_EVAL_RUNS || '3' },
			model: { type: 'string', default: process.env.AI_EVAL_MODEL || 'claude-opus-4-7' },
			baseUrl: { type: 'string', default: process.env.AI_EVAL_BASE_URL || 'http://localhost:5180' },
			skipStagehand: { type: 'boolean', default: false }, // SS 既出 + Multi-Agent のみ
			skipMultiAgent: { type: 'boolean', default: false }, // Stagehand + axe のみ (API cost 抑制)
			mock: { type: 'boolean', default: false }, // mock smoke test (cost $0、Issue #2692)
			'mock-runs': { type: 'string', default: '3' }, // mock 時の Self-Consistency runs 数
			help: { type: 'boolean', short: 'h', default: false },
		},
		allowPositionals: false,
	});
	return values;
}

function printHelp() {
	console.log(`
AI Heuristic Evaluator POC (Issue #2692 / EPIC #2691)

Usage:
  node scripts/ai-evaluation/run-poc.mjs [options]

Options:
  --type <name>          評価対象 type (default: activity-pack)
                         POC は activity-pack のみ実装、reward-set / rule-preset は別 round (sub #N3 / #N4)
  --age <mode>           age mode: baby | preschool | elementary | junior | senior | all (default: preschool)
  --runs <N>             Self-Consistency runs (default: 3、POC naive)
  --model <name>         Claude model (default: claude-opus-4-7)
  --baseUrl <url>        demo Lambda env URL (default: http://localhost:5180)
  --skipStagehand        既存 SS を使い Multi-Agent のみ実行 (API cost 確認用)
  --skipMultiAgent       Stagehand + axe のみ実行 (Anthropic API 不使用、smoke test)
  --mock                 Mock mode: 実 Claude API / browser / axe-core 起動なし
                         realistic dummy response で pipeline structural 健全性のみ検証 (cost $0)
  --mock-runs <N>        Mock 時の Self-Consistency runs 数 (default: 3)
  --help, -h             ヘルプ表示

Prerequisite (--mock 不使用時):
  - .env.local に ANTHROPIC_API_KEY を配備 (--skipMultiAgent / --mock 時は不要)
  - demo Lambda env を別 terminal で起動 (--mock 時は不要):
      AUTH_MODE=anonymous DATA_SOURCE=demo npm run preview -- --port 5180

Examples:
  # preschool 1 age mode で full POC (実 Claude API、cost $5-10)
  node scripts/ai-evaluation/run-poc.mjs --type activity-pack --age preschool

  # 5 age mode 全部 (実 Claude API、約 $25-50、要注意)
  node scripts/ai-evaluation/run-poc.mjs --type activity-pack --age all

  # Stagehand + axe smoke test のみ (API cost 0、demo Lambda env 必要)
  node scripts/ai-evaluation/run-poc.mjs --age preschool --skipMultiAgent

  # Mock smoke test (cost $0、demo Lambda env / API key 一切不要、pipeline 動作検証用)
  node scripts/ai-evaluation/run-poc.mjs --mock --age preschool
  node scripts/ai-evaluation/run-poc.mjs --mock --age preschool --mock-runs 3
`);
}

/**
 * 単一 age mode で Stagehand 自動探索 + axe-core 全 step 実行
 */
async function runStagehandFlowForAge({ stagehand, baseUrl, ageMode }) {
	const childId = FIXTURE_CHILDREN[ageMode];
	console.log(`[poc] age=${ageMode}, childId=${childId} で Stagehand 自動探索開始`);
	await setChildContext(stagehand, baseUrl, childId);

	const screenshots = [];
	const axeReports = [];

	for (const step of ACTIVITY_PACK_FLOW) {
		const ssPath = resolve(OUTPUT_DIR, `ss-${ageMode}-step${step.step}.png`);
		let stepPage = null;
		try {
			const result = await executeStep(stagehand, step, baseUrl, ssPath);
			screenshots.push(result.screenshotPath);
			stepPage = result.page; // v3: executeStep が page を返すため再 lookup 不要
		} catch (err) {
			console.warn(`[poc] step ${step.step} (${ageMode}) 失敗、continue: ${err.message}`);
		}

		// axe-core: 全 step で audit (DoR 12 整合)
		// v3 では stagehand.page プロパティが無いため getActivePage で取得
		// (executeStep 失敗時は fallback で active page 再取得)
		const axeJsonPath = resolve(OUTPUT_DIR, `axe-${ageMode}-step${step.step}.json`);
		try {
			const auditPage = stepPage || (await getActivePage(stagehand));
			const audit = await runFullAudit({ page: auditPage, ageMode, axeJsonPath });
			axeReports.push({ step: step.step, ...audit });
		} catch (err) {
			console.warn(`[poc] axe step ${step.step} (${ageMode}) 失敗、continue: ${err.message}`);
		}
	}

	return { screenshots, axeReports };
}

/**
 * 単一 age mode で Multi-Agent 評価実行 + 集約 JSON 保存 + filter session md 保存
 */
async function runMultiAgentForAge({
	apiKey,
	model,
	runs,
	type,
	ageMode,
	screenshots,
	axeReports,
	mock = false,
}) {
	const callBudget = 5 * runs;
	console.log(
		`[poc] age=${ageMode} で Multi-Agent 評価 (5 Role × ${runs} runs = ${callBudget} ${mock ? 'MOCK call' : 'API call'}) 開始`,
	);
	const contextExtra = {
		axe_summary: axeReports.map((r) => ({
			step: r.step,
			critical: r.axe?.critical,
			serious: r.axe?.serious,
			moderate: r.axe?.moderate,
			tap_size_violations: r.childFriendly?.violations?.length || 0,
			tap_size_expected_min_px: r.childFriendly?.expectedMin,
		})),
		fixture_child_id: FIXTURE_CHILDREN[ageMode],
		ui_mode: ageMode,
		notes:
			'POC naive Self-Consistency 3 runs、Phase 1 完成後 5-10 runs に upgrade 予定 (task #192)',
	};

	const aggregated = await evaluateWithMultiAgent({
		apiKey,
		model,
		runs,
		type,
		ageMode,
		screenshotPaths: screenshots,
		contextExtra,
		mock,
	});

	const evalJsonPath = resolve(OUTPUT_DIR, `evaluation-${type}-${ageMode}.json`);
	await saveEvaluation(evalJsonPath, aggregated);
	console.log(`[poc] 集約 JSON 保存: ${evalJsonPath}`);

	const today = new Date().toISOString().slice(0, 10);
	const filterMdPath = resolve(ROOT, 'tmp', `round18-review-${type}-${ageMode}-${today}.md`);
	await saveFilterSession(filterMdPath, aggregated);
	console.log(`[poc] User filter session 保存: ${filterMdPath}`);

	return { aggregated, evalJsonPath, filterMdPath };
}

/**
 * .env.local の最低限読込み (dotenv 依存追加せず手書きで POC scope)
 */
async function loadDotEnvLocal() {
	const dotenvPath = resolve(ROOT, '.env.local');
	if (!existsSync(dotenvPath)) {
		console.warn(`[poc] .env.local 不在 (${dotenvPath})、process.env のみ参照`);
		return;
	}
	const content = await fs.readFile(dotenvPath, 'utf-8');
	for (const line of content.split('\n')) {
		const m = line.match(/^([A-Z][A-Z0-9_]+)\s*=\s*(.*)$/);
		if (m) {
			const key = m[1];
			const val = m[2].replace(/^["']|["']$/g, '');
			if (!process.env[key]) process.env[key] = val;
		}
	}
}

async function main() {
	const args = parseCliArgs();
	if (args.help) {
		printHelp();
		process.exit(0);
	}

	await loadDotEnvLocal();
	await fs.mkdir(OUTPUT_DIR, { recursive: true });

	const type = args.type;
	const ageInputs = args.age === 'all' ? AGE_MODES : [args.age];
	const mock = args.mock === true;
	// mock 時は mock-runs を優先、それ以外は runs
	const runs = mock ? Number(args['mock-runs']) : Number(args.runs);
	const baseUrl = args.baseUrl;
	const model = args.model;
	const apiKey = process.env.ANTHROPIC_API_KEY;

	console.log(
		`[poc] type=${type}, ages=${ageInputs.join(',')}, runs=${runs}, model=${model}, baseUrl=${baseUrl}, mock=${mock}`,
	);

	// Mock mode 時は API key check / demo Lambda check 不要 (cost $0)
	if (!mock && !args.skipMultiAgent && !apiKey) {
		console.error(
			'\n[poc] ERROR: ANTHROPIC_API_KEY 未設定。\n' +
				'  - .env.local に ANTHROPIC_API_KEY=sk-ant-... を配備\n' +
				'  - または `export ANTHROPIC_API_KEY=...` で env 設定\n' +
				'  - smoke test (API 不使用) なら `--skipMultiAgent` を付与\n' +
				'  - mock smoke test (cost $0) なら `--mock` を付与\n',
		);
		process.exit(2);
	}

	// age mode validate
	for (const age of ageInputs) {
		if (!AGE_MODES.includes(age)) {
			console.error(`[poc] ERROR: 不正な age mode: ${age} (valid: ${AGE_MODES.join(',')} | all)`);
			process.exit(2);
		}
	}

	let stagehand = null;
	const results = {};

	try {
		if (!args.skipStagehand) {
			console.log(`[poc] Stagehand 初期化中 (baseUrl=${baseUrl}, mock=${mock})…`);
			stagehand = await createStagehand({
				baseUrl,
				apiKey: apiKey || 'dummy-for-stagehand-init',
				model,
				mock,
			});
		}

		for (const ageMode of ageInputs) {
			let screenshots = [];
			let axeReports = [];

			if (!args.skipStagehand) {
				const flowResult = await runStagehandFlowForAge({ stagehand, baseUrl, ageMode });
				screenshots = flowResult.screenshots;
				axeReports = flowResult.axeReports;
			} else {
				// skipStagehand: 既存 SS path を 5 step 分推定
				screenshots = ACTIVITY_PACK_FLOW.map((step) =>
					resolve(OUTPUT_DIR, `ss-${ageMode}-step${step.step}.png`),
				).filter((p) => existsSync(p));
				console.log(`[poc] skipStagehand: 既存 SS ${screenshots.length} 件で評価`);
			}

			if (args.skipMultiAgent) {
				console.log(`[poc] skipMultiAgent: ${ageMode} は SS + axe 出力のみで stop`);
				results[ageMode] = { screenshots, axeReports };
				continue;
			}

			if (screenshots.length === 0) {
				console.warn(`[poc] age=${ageMode}: SS 0 件のため Multi-Agent skip (Stagehand failure?)`);
				results[ageMode] = { screenshots: [], axeReports, skipped: 'no_screenshots' };
				continue;
			}

			const multiResult = await runMultiAgentForAge({
				apiKey,
				model,
				runs,
				type,
				ageMode,
				screenshots,
				axeReports,
				mock,
			});
			results[ageMode] = { screenshots, axeReports, ...multiResult };
		}
	} catch (err) {
		console.error(`[poc] FATAL: ${err.message}`);
		console.error(err.stack);
		process.exit(1);
	} finally {
		if (stagehand) await closeStagehand(stagehand);
	}

	// POC 結果 summary 出力
	const summaryPath = resolve(
		ROOT,
		'tmp',
		`round18-poc-result-${new Date().toISOString().slice(0, 10)}.md`,
	);
	await fs.writeFile(
		summaryPath,
		`# POC 結果 summary (Issue #2692)

- Type: ${type}
- Ages: ${ageInputs.join(', ')}
- Runs: ${runs} (Self-Consistency naive)
- Model: ${model}
- Base URL: ${baseUrl}

## age mode 別結果

${Object.entries(results)
	.map(
		([age, r]) => `### ${age}

- SS: ${r.screenshots?.length || 0} 枚
- axe-core: ${r.axeReports?.length || 0} cycle
- evaluation JSON: ${r.evalJsonPath || '(未生成)'}
- filter session md: ${r.filterMdPath || '(未生成)'}
- skipped: ${r.skipped || 'no'}
`,
	)
	.join('\n')}

## 次 step

1. \`tmp/round18-review-<type>-<age>-*.md\` を browser で開き Section 1-4 を filter
2. severity 3-4 で Yes 承認した項目を Issue 起票 (label: cx-review)
3. Issue #2693 で 5 軸実測 (Recall / FN / FP / Kappa / 立ち会い時間)
`,
		'utf-8',
	);
	console.log(`[poc] POC summary 保存: ${summaryPath}`);
}

main().catch((err) => {
	console.error(`[poc] uncaught: ${err.message}`);
	console.error(err.stack);
	process.exit(1);
});
