/**
 * Layer A — Self-Consistency (CISC confidence weighted majority) — Issue #2711 Phase 1.1
 *
 * 原理 (arXiv 2502.06233 CISC = Confidence-Informed Self-Consistency):
 *   1. 同一 prompt を k=3 回独立実行 (temperature 0.7-0.9 diversity)
 *   2. 各 response から within-question confidence (response probability / verbal confidence) を抽出
 *   3. confidence weighted majority vote で答えを集約 (uniform vote ではない)
 *   4. low certainty (cross-run divergence 高) を Layer B/C escalate 対象に flag
 *
 * SSOT (逐語コピー元): tmp/round18-phase1-poc-design-2026-05-30.md §3 (Layer A 詳細 spec)
 *
 * FP 削減効果: arXiv 2502.06233 で 40-90% 削減実証、本 product honest 予測 40-50% 削減 (-20% 補正で 30-40%)
 *
 * cost 試算 (Real mode、prompt caching 90% off 前提):
 *   - System prompt token (cache 対象): ~5000 tokens
 *   - 50 SS image tokens: ~50,000 tokens (1000/image)
 *   - Total Layer A cost (k=3): $2-5 (cache hit) / $3-8 (cache miss)
 */

import { promises as fs } from 'node:fs';

const TEMPERATURES = [0.7, 0.75, 0.85]; // k=3、Phase 1.2 で k=5-10 + temperature diversification

/**
 * SS path 配列を Anthropic Messages content block (base64 image) に変換
 */
async function attachScreenshots(screenshotPaths) {
	const blocks = [];
	for (const ssPath of screenshotPaths) {
		try {
			const buf = await fs.readFile(ssPath);
			blocks.push({
				type: 'image',
				source: {
					type: 'base64',
					media_type: 'image/png',
					data: buf.toString('base64'),
				},
			});
		} catch (err) {
			console.warn(`[layer-a] SS load 失敗 (skip): ${ssPath} — ${err.message}`);
		}
	}
	return blocks;
}

/**
 * CISC severity bucket 化 (key clustering 用)
 */
function severityBucket(s) {
	if (s <= 1) return '0-1';
	if (s <= 3) return '2-3';
	return '4';
}

/**
 * Mock response 生成 (cost $0、PR #2695 mock pattern 同型)
 *
 * vote 分散制御:
 *   - run 0/2 で「ほぼ同じ + 一部 variant」、run 1 で variant 削減
 *   - 3 runs 中 3/3 全員一致 → certainty 1.0 (ai-single ルート、Layer B/C skip 候補)
 *   - 3 runs 中 2/3 → certainty 0.67 (layer-bc escalate)
 *   - 3 runs 中 1/3 のみ → certainty 0.33 (user-filter pool)
 */
function buildMockResponse(runIndex, type) {
	const driftKey = runIndex % 2 === 0 ? 'A' : 'B';
	return {
		findings: [
			// 高 certainty 想定 (3/3 一致)
			{
				id: `mock-l1-001-${runIndex}`,
				step: 3,
				age_tier: 'preschool',
				viewport: 'mobile',
				heuristic: 6,
				result: 'No',
				severity: 3,
				rationale: `preschool で marketplace preset card の age range フィルター chip が非表示、不適合 preset 選択リスク (${type})`,
				evidence_ss_name: 'preschool-mobile-step3-marketplace-browse.webp',
				evidence_term_quote: 'CHILD_SELECTION_TERMS.dialogTitleSuffix',
				confidence: 0.85,
			},
			// 中 certainty 想定 (2/3 一致、Layer B/C escalate)
			{
				id: `mock-l1-002-${runIndex}`,
				step: 4,
				age_tier: 'elementary',
				viewport: 'desktop',
				heuristic: 1,
				result: driftKey === 'A' ? 'No' : 'Partial',
				severity: driftKey === 'A' ? 3 : 2,
				rationale: `ChildSelectionDialog 表示時に visibility transition が ${driftKey === 'A' ? '不明瞭' : 'やや不明瞭'}、状態 feedback 不足の疑い`,
				evidence_ss_name: 'elementary-desktop-step4-preset-detail.webp',
				evidence_term_quote: 'N/A',
				confidence: driftKey === 'A' ? 0.7 : 0.55,
			},
			// 低 certainty 想定 (run 0 のみ報告、Layer B/C escalate or user-filter)
			...(driftKey === 'A'
				? [
						{
							id: `mock-l1-003-${runIndex}`,
							step: 5,
							age_tier: 'junior',
							viewport: 'mobile',
							heuristic: 7,
							result: 'Partial',
							severity: 2,
							rationale: '取込完了 toast の display 時間が junior tier (高校生) 視点で短すぎる懸念',
							evidence_ss_name: 'junior-mobile-step5-import-complete.webp',
							evidence_term_quote: 'N/A',
							confidence: 0.45,
						},
					]
				: []),
		],
		metadata: {
			model: 'mock-claude-opus-4-7',
			temperature: TEMPERATURES[runIndex] || 0.7,
			run_index: runIndex,
		},
	};
}

/**
 * Anthropic SDK lazy import (Real mode のみ必要、PR #2695 pattern 同型)
 */
async function loadAnthropic() {
	try {
		// Vite static-analysis 回避: dynamic spec を変数経由で構築 (Mock test 時に未 install でも build 通過)
		// Real mode (--mock=false) で初実行されるため、Phase 1.2 で `npm install -D @anthropic-ai/sdk@^0.40`
		// 前提 (PR #2695 で既存採用済の場合は worktree merge 時に解決)
		const specName = ['@anthropic-ai', 'sdk'].join('/');
		const mod = await import(/* @vite-ignore */ specName);
		return mod.default ?? mod;
	} catch (err) {
		throw new Error(
			`@anthropic-ai/sdk load 失敗: ${err.message}\n` +
				`本 layer は npm install -D @anthropic-ai/sdk@^0.40 が前提です (PR #2695 で既存採用済)。`,
		);
	}
}

/**
 * 単一 run を Anthropic API で呼出
 */
async function callSingleRun({ client, model, systemPrompt, userInstruction, ssBlocks, runIndex }) {
	const userContent = [
		...ssBlocks,
		{
			type: 'text',
			text: `${userInstruction}\n\nrun_index=${runIndex}。前後の説明文・コードフェンス禁止、JSON のみで返してください。`,
		},
	];
	const res = await client.messages.create({
		model,
		max_tokens: 6000,
		temperature: TEMPERATURES[runIndex] || 0.7,
		system: systemPrompt,
		messages: [{ role: 'user', content: userContent }],
	});
	const textBlocks = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text);
	const raw = textBlocks.join('\n').trim();
	const jsonStr = raw
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/, '')
		.trim();
	try {
		return { parsed: JSON.parse(jsonStr), raw, runIndex };
	} catch (parseErr) {
		return { error: `JSON parse 失敗: ${parseErr.message}`, raw, runIndex };
	}
}

/**
 * CISC confidence weighted majority aggregation
 *
 * key: step|age_tier|viewport|heuristic|severityBucket
 * certainty = agreement_count / k * avg_confidence
 *
 * escalateTo:
 *   - "ai-single"  : 4/5 以上 + certainty ≥ 0.7   (AI 単独判定、Layer B/C skip)
 *   - "layer-bc"   : 3/5 以上 + certainty ≥ 0.4   (Layer B/C escalate)
 *   - "user-filter": それ以下                     (User filter pool)
 */
function ciscAggregate(runs) {
	const parsed = runs.filter((r) => r.parsed);
	const k = runs.length;

	const findings = new Map();
	for (const r of parsed) {
		for (const f of r.parsed.findings || []) {
			const key = `${f.step}|${f.age_tier}|${f.viewport}|${f.heuristic}|${severityBucket(f.severity)}`;
			const agg = findings.get(key) ?? {
				count: 0,
				confidenceSum: 0,
				severitySum: 0,
				rationales: [],
				ids: [],
				runIndices: [],
				evidence_ss_name: f.evidence_ss_name,
				evidence_term_quote: f.evidence_term_quote,
			};
			agg.count += 1;
			agg.confidenceSum += f.confidence ?? 0.5;
			agg.severitySum += f.severity ?? 0;
			agg.rationales.push(f.rationale);
			agg.ids.push(f.id);
			agg.runIndices.push(r.runIndex);
			findings.set(key, agg);
		}
	}

	const aggregated = Array.from(findings.entries()).map(([key, agg]) => {
		const [step, age_tier, viewport, heuristic, severityBucketStr] = key.split('|');
		const agreement = agg.count / k;
		const avgConfidence = agg.confidenceSum / agg.count;
		const certainty = agreement * avgConfidence;
		const avgSeverity = agg.severitySum / agg.count;

		let escalateTo = 'user-filter';
		if (agg.count >= k * 0.8 && certainty >= 0.7) escalateTo = 'ai-single';
		else if (agg.count >= k * 0.6 && certainty >= 0.4) escalateTo = 'layer-bc';

		return {
			id: agg.ids[0],
			step: Number(step),
			age_tier,
			viewport,
			heuristic: Number(heuristic),
			severity_bucket: severityBucketStr,
			avg_severity: avgSeverity,
			certainty,
			agreement_count: agg.count,
			runs_total: k,
			rationales: agg.rationales,
			evidence_ss_name: agg.evidence_ss_name,
			evidence_term_quote: agg.evidence_term_quote,
			escalate_to: escalateTo,
		};
	});

	return {
		layer: 'A',
		runs_total: k,
		runs_parsed: parsed.length,
		runs_failed: runs.length - parsed.length,
		findings_in: 0, // Layer A は initial
		findings_out: aggregated.length,
		kill_rate: 0, // Layer A は kill しない、escalate のみ
		aggregated,
		errors: runs.filter((r) => r.error).map((r) => r.error),
	};
}

/**
 * Layer A 実行 entry (Real / Mock 両対応)
 *
 * @param {Object} opts
 * @param {string} opts.type - 'activity-pack' 等
 * @param {number} opts.runs - k=3 (POC naive)
 * @param {string} opts.model - 'claude-opus-4-7'
 * @param {boolean} opts.mock - true で realistic dummy
 * @param {string|undefined} opts.anthropicApiKey - Real mode 必須
 * @param {string[]} opts.screenshotPaths - 50 SS の path 配列
 * @param {string} opts.systemPrompt - SYSTEM_PROMPT_HEURISTIC_EVALUATOR (prompt-templates から構築)
 * @param {string} opts.userInstruction - flow description
 */
export async function runLayerA({
	type,
	runs = 3,
	model = 'claude-opus-4-7',
	mock = false,
	anthropicApiKey,
	screenshotPaths = [],
	systemPrompt = '',
	userInstruction = '',
}) {
	if (mock) {
		console.log(`[layer-a] MOCK mode: ${runs} runs realistic dummy response`);
		const runResults = Array.from({ length: runs }, (_, i) => ({
			parsed: buildMockResponse(i, type),
			raw: '(mock)',
			runIndex: i,
		}));
		return ciscAggregate(runResults);
	}

	if (!anthropicApiKey) throw new Error('[layer-a] ANTHROPIC_API_KEY 必須 (mock=false)');
	const Anthropic = await loadAnthropic();
	const client = new Anthropic({ apiKey: anthropicApiKey });
	const ssBlocks = await attachScreenshots(screenshotPaths);

	const runResults = await Promise.all(
		Array.from({ length: runs }, (_, i) =>
			callSingleRun({ client, model, systemPrompt, userInstruction, ssBlocks, runIndex: i }),
		),
	);
	return ciscAggregate(runResults);
}
