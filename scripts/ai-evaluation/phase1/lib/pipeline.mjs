/**
 * 6 Layer Stack Pipeline 統合 — Issue #2711 Phase 1.1
 *
 * 構成 C5 (全 6 layer):
 *   Layer A (Self-Consistency) → Layer B (Multi-Agent Debate) → Layer C (Refute-or-Promote, 79% kill rate 主担保)
 *   → Layer D (Constitutional P1-P7) → Layer E (Synthetic HE + dedup) → Layer F (Cohen's Kappa calibration)
 *
 * SSOT (構造的逐語コピー元): tmp/round18-phase1-poc-design-2026-05-30.md §1-§10
 *
 * Mock smoke test 用途:
 *   - 6 layer 順次起動 + 各 layer 間 input/output integrate を assert
 *   - findings_in / findings_out / kill_rate / aggregated を全 layer で記録
 *   - Mock では layer 間で findings が「投入数 → 削減 → 集約」と健全に減衰することを確認
 */

import { existsSync, promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLayerA } from './layer1-self-consistency.mjs';
import { runLayerB } from './layer2-multi-agent-debate.mjs';
import { runLayerC } from './layer3-refute-or-promote.mjs';
import { runLayerD } from './layer4-constitutional.mjs';
import { runLayerE } from './layer5-synthetic-he.mjs';
import { runLayerF } from './layer6-judge-verdict.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = resolve(__dirname, 'prompt-templates');

/**
 * Prompt template (5 Role の .md ファイル) 全件読込
 *
 * @returns {Promise<Record<string, string>>}
 */
export async function loadPromptTemplates() {
	/** @type {Record<string, string>} */
	const templates = {};
	const files = [
		'role-toddler-parent.md',
		'role-elementary-parent.md',
		'role-junior-student.md',
		'role-nn-g-heuristic.md',
		'role-mercari-cgi.md',
	];
	for (const f of files) {
		const p = resolve(PROMPT_DIR, f);
		if (existsSync(p)) {
			templates[f.replace('.md', '')] = await fs.readFile(p, 'utf8');
		}
	}
	return templates;
}

/**
 * Stub SS path 生成 (Mock 時、本 SS 撮影は PR #2695 経由)
 *
 * 5 age tier × 2 viewport × 5 step = 50 stub path
 *
 * @param {string} type
 * @returns {string[]}
 */
function generateStubScreenshotPaths(type) {
	const ageTiers = ['baby', 'preschool', 'elementary', 'junior', 'senior'];
	const viewports = ['mobile', 'desktop'];
	const steps = [1, 2, 3, 4, 5];
	/** @type {string[]} */
	const paths = [];
	for (const tier of ageTiers) {
		for (const vp of viewports) {
			for (const step of steps) {
				paths.push(`tmp/round18-poc/stub-ss/${tier}-${vp}-step${step}-${type}.webp`);
			}
		}
	}
	return paths;
}

/**
 * 6 Layer Stack 統合 pipeline 実行 entry
 *
 * @param {Object} opts
 * @param {string} opts.type - 'activity-pack' 等
 * @param {number} [opts.runs] - Self-Consistency k=3
 * @param {string} [opts.model] - 'claude-opus-4-7'
 * @param {boolean} [opts.mock] - true で全 layer Mock smoke
 * @param {string} [opts.anthropicApiKey] - Real mode 必須
 * @param {string} [opts.geminiApiKey] - Layer C Stage D 必須 (Real mode)
 * @param {string} [opts.screenshotsDir] - 既存 SS dir (default: stub)
 * @returns {Promise<Record<string, any>>}
 */
export async function runPipeline({
	type,
	runs = 3,
	model = 'claude-opus-4-7',
	mock = false,
	anthropicApiKey,
	geminiApiKey,
	screenshotsDir,
}) {
	const startTime = Date.now();
	const screenshotPaths = screenshotsDir
		? // TODO: dir scan の実装は Phase 1.2 (Stagehand 連携時)
			generateStubScreenshotPaths(type)
		: generateStubScreenshotPaths(type);

	const templates = await loadPromptTemplates();
	console.log(
		`[pipeline] loaded ${Object.keys(templates).length} prompt templates: ${Object.keys(templates).join(', ')}`,
	);

	// systemPrompt は templates をそのまま結合 (Real mode で適用、Mock では参照のみ)
	const systemPrompt = Object.entries(templates)
		.map(([k, v]) => `# ${k}\n${v}\n`)
		.join('\n');
	const userInstruction = `本 product (がんばりクエスト) の ${type} type 取込 critical flow 5 step を評価せよ。`;

	// Layer A
	console.log(`\n[pipeline] ===== Layer A (Self-Consistency, k=${runs}) =====`);
	const layerA = await runLayerA({
		type,
		runs,
		model,
		mock,
		anthropicApiKey,
		screenshotPaths,
		systemPrompt,
		userInstruction,
	});

	// Layer B
	console.log(`\n[pipeline] ===== Layer B (Multi-Agent Debate, KS-test ε=0.05) =====`);
	const layerB = await runLayerB({
		layerAOutput: layerA,
		model,
		mock,
		anthropicApiKey,
		screenshotPaths,
		systemPromptByRole: templates,
		userInstruction,
	});

	// Layer C (79% kill rate 主担保)
	console.log(`\n[pipeline] ===== Layer C (Refute-or-Promote, Stage A/B/D) =====`);
	const layerC = await runLayerC({
		layerBOutput: layerB,
		mock,
		anthropicApiKey,
		// Mock で Gemini API key 未配備 simulate
		geminiApiKey: mock ? geminiApiKey || 'mock-enabled' : geminiApiKey,
		screenshotPaths,
	});

	// Layer D
	console.log(`\n[pipeline] ===== Layer D (Constitutional P1-P7) =====`);
	const layerD = await runLayerD({
		layerCOutput: layerC,
		mock,
		anthropicApiKey,
		model,
	});

	// Layer E
	console.log(`\n[pipeline] ===== Layer E (Synthetic HE, Nielsen 10 split + dedup) =====`);
	const layerE = await runLayerE({
		layerDOutput: layerD,
		mock,
		anthropicApiKey,
		model,
	});

	// Layer F (calibration)
	console.log(`\n[pipeline] ===== Layer F (Cohen's Kappa Calibration) =====`);
	const layerF = await runLayerF({
		layerEOutput: layerE,
		groundTruth: [], // Real mode で User 30 分実機操作後配備、Mock では stub auto-derive
		userFilterTimeSeconds: 18 * 60, // Mock では 18 分と stub (実測は AC4 で別 step)
		layerOutputs: {
			A: layerA,
			B: layerB,
			C: layerC,
			D: layerD,
			E: layerE,
		},
		mock,
	});

	const totalDurationMs = Date.now() - startTime;

	// 集約 result schema (Issue #2711 AC3)
	const result = {
		type,
		evaluation_date: new Date().toISOString(),
		mode: mock ? 'mock' : 'real',
		model,
		runs,
		total_duration_ms: totalDurationMs,
		layers: [
			{
				layer: 'A',
				findings_in: 0,
				findings_out: layerA.findings_out,
				kill_rate: layerA.kill_rate,
				runs_parsed: layerA.runs_parsed,
			},
			{
				layer: 'B',
				findings_in: layerB.findings_in,
				findings_out: layerB.findings_out,
				kill_rate: layerB.kill_rate,
				rounds_executed: layerB.rounds_executed,
				adaptive_stop_triggered: layerB.adaptive_stop_triggered,
			},
			{
				layer: 'C',
				findings_in: layerC.findings_in,
				findings_out: layerC.findings_out,
				kill_rate: layerC.kill_rate,
				stages: layerC.stages,
			},
			{
				layer: 'D',
				findings_in: layerD.findings_in,
				findings_out: layerD.findings_out,
				kill_rate: layerD.kill_rate,
				principles: layerD.principles,
			},
			{
				layer: 'E',
				findings_in: layerE.findings_in,
				findings_out: layerE.findings_out,
				dedup_reduction: layerE.dedup_reduction,
			},
			{
				layer: 'F',
				findings_in: layerF.findings_in,
				findings_out: layerF.findings_out,
				metrics: layerF.metrics,
				layer_kappa: layerF.layer_kappa,
				layer_weights: layerF.layer_weights,
				achievement: layerF.achievement,
			},
		],
		summary: {
			total_findings_initial: layerA.findings_out,
			total_findings_final: layerF.findings_out,
			fp_pct: layerF.metrics.fp_rate * 100,
			fn_pct: layerF.metrics.fn_rate * 100,
			recall_pct: layerF.metrics.recall * 100,
			kappa: layerF.metrics.cohen_kappa,
			user_filter_time_min: layerF.metrics.user_filter_time_min,
			achievement: layerF.achievement,
		},
		final_findings: layerF.aggregated,
	};

	return result;
}
