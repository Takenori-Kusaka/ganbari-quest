/**
 * Multi-Agent AI Evaluator + Self-Consistency naive 3 runs (Issue #2692 AC4-AC6)
 *
 * 役割:
 *   - 5 Role (Planner / Adversarial / Persona A / Persona B / Brand) prompt を順次実行
 *   - 各 Role を Self-Consistency 3 runs (Promise.all 並列) で多数決
 *   - 3 runs 中 2+ 一致 → high certainty (>0.7)、バラバラ → low certainty (<0.3)
 *   - 集約 JSON を tmp/round18/evaluation-activity-pack.json に出力 (AC6 schema)
 *
 * SSOT:
 *   - tmp/round18-parallel-path-first-review-plan-2026-05-30.md §5
 *   - scripts/ai-evaluation/lib/prompt-templates/index.mjs (5 Role prompt + DOMAIN_CONTEXT)
 *
 * 改善 path (Phase 1 = task #192 完成後):
 *   - 3 runs → 5-10 runs (CISC arXiv 2502.06233)
 *   - temperature randomization + paraphrasing で diversity 確保
 *   - Multi-Agent Debate KS-test adaptive stability
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { PROMPT_TEMPLATES } from './prompt-templates/index.mjs';

/**
 * Anthropic SDK を lazy import
 */
async function loadAnthropic() {
	try {
		const { default: Anthropic } = await import('@anthropic-ai/sdk');
		return Anthropic;
	} catch (err) {
		throw new Error(
			`@anthropic-ai/sdk load 失敗: ${err.message}\n` +
				`本 POC は npm install -D @anthropic-ai/sdk@^0.100 が前提です。`,
		);
	}
}

/**
 * Image attachment 配列を Anthropic Messages content block 形式に変換
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
			console.warn(`[multi-agent] SS load 失敗 (skip): ${ssPath} — ${err.message}`);
		}
	}
	return blocks;
}

/**
 * 単一 Role を Anthropic API で 1 回呼び出し
 *
 * @param {Anthropic} client
 * @param {string} model
 * @param {string} systemPrompt - 5 Role の prompt の 1 件
 * @param {string} userInstruction - "Evaluate the SS and report JSON"
 * @param {string[]} screenshotPaths - input SS の絶対 path 配列
 * @param {Object} contextExtra - axe-core summary 等の追加 context
 * @returns {Promise<Object>} parsed JSON or { error: string, raw: string }
 */
async function callSingleRole({
	client,
	model,
	systemPrompt,
	userInstruction,
	screenshotPaths,
	contextExtra,
}) {
	const ssBlocks = await attachScreenshots(screenshotPaths);
	const userContent = [
		{
			type: 'text',
			text: `${userInstruction}\n\n# 追加 context (axe-core 等)\n${JSON.stringify(contextExtra, null, 2)}\n\n# 厳守\n- 必ず JSON のみで返す (前後の説明文・コードフェンス禁止)\n- SS にない要素を「ある」とは絶対に書かない (hallucination 抑制)\n- 確証なきは severity を低く / Unknown を返す`,
		},
		...ssBlocks,
	];

	try {
		const res = await client.messages.create({
			model,
			max_tokens: 4000,
			temperature: 0.7,
			system: systemPrompt,
			messages: [{ role: 'user', content: userContent }],
		});

		// text block 抽出 + JSON parse
		const textBlocks = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text);
		const raw = textBlocks.join('\n').trim();
		// ```json ... ``` を剥がす最小 robust
		const jsonStr = raw
			.replace(/^```(?:json)?\s*/i, '')
			.replace(/```\s*$/, '')
			.trim();

		try {
			return { parsed: JSON.parse(jsonStr), raw };
		} catch (parseErr) {
			return { error: `JSON parse 失敗: ${parseErr.message}`, raw };
		}
	} catch (apiErr) {
		return { error: `Anthropic API 失敗: ${apiErr.message}`, raw: '' };
	}
}

/**
 * Self-Consistency naive: 同一 prompt × N runs を Promise.all で並列、結果配列を返す
 */
async function selfConsistencyRuns({
	client,
	model,
	systemPrompt,
	userInstruction,
	screenshotPaths,
	contextExtra,
	runs,
}) {
	const results = await Promise.all(
		Array.from({ length: runs }, () =>
			callSingleRole({
				client,
				model,
				systemPrompt,
				userInstruction,
				screenshotPaths,
				contextExtra,
			}),
		),
	);
	return results;
}

/**
 * 多数決 certainty 計算
 *
 * - 3 runs 全件パースエラー → certainty=0, parsed=null
 * - JSON parse 成功 N/total → certainty = N/total
 * - 「同じ step + 同じ heuristic / question」の検出ペアが N/total runs で一致 → high certainty 候補
 *
 * POC 簡易実装: 各 run の構造化結果を merge し certainty = (parse 成功数 / total) を proxy 値として使う。
 * Phase 1 (task #192) で「severity / evidence 文字列の semantic 一致」基準に upgrade 想定。
 */
function aggregateRuns(runs) {
	const parsedRuns = runs.filter((r) => r.parsed);
	const certainty = runs.length > 0 ? parsedRuns.length / runs.length : 0;
	return {
		runs_total: runs.length,
		runs_parsed: parsedRuns.length,
		certainty, // POC: parse 成功率を certainty の暫定 proxy として使用
		samples: parsedRuns.map((r) => r.parsed),
		errors: runs.filter((r) => r.error).map((r) => r.error),
	};
}

/**
 * 5 Role × Self-Consistency 3 runs で activity-pack 1 age mode を評価
 *
 * @param {Object} opts
 * @param {string} opts.apiKey - ANTHROPIC_API_KEY
 * @param {string} opts.model - 'claude-opus-4-7' 等
 * @param {number} opts.runs - 3 (POC naive、Phase 1 完成後 5-10)
 * @param {string} opts.type - 'activity-pack'
 * @param {string} opts.ageMode - 'preschool' 等
 * @param {string[]} opts.screenshotPaths - 5 step の SS path 配列
 * @param {Object} opts.contextExtra - axe-core summary 等
 * @returns {Promise<Object>} 集約 JSON (AC6 schema)
 */
export async function evaluateWithMultiAgent({
	apiKey,
	model = 'claude-opus-4-7',
	runs = 3,
	type,
	ageMode,
	screenshotPaths,
	contextExtra = {},
}) {
	if (!apiKey) throw new Error('ANTHROPIC_API_KEY 必須');
	const Anthropic = await loadAnthropic();
	const client = new Anthropic({ apiKey });

	const userInstruction = `Evaluate the ${screenshotPaths.length} attached screenshots for type=${type}, age_mode=${ageMode}. Apply your assigned Role only. Output JSON strictly per the schema in your system prompt.`;

	// 5 Role を順次評価 (並列も可能だが API rate limit + cost 抑制で sequential)
	const roleResults = {};
	for (const [roleName, systemPrompt] of Object.entries(PROMPT_TEMPLATES)) {
		console.log(`[multi-agent] role=${roleName} × runs=${runs} で評価中…`);
		const runs_arr = await selfConsistencyRuns({
			client,
			model,
			systemPrompt,
			userInstruction,
			screenshotPaths,
			contextExtra,
			runs,
		});
		roleResults[roleName] = aggregateRuns(runs_arr);
	}

	// 集約 (AC6 schema 整合)
	const aggregated = {
		type,
		age_mode: ageMode,
		evaluation_date: new Date().toISOString().slice(0, 10),
		model,
		self_consistency_runs: runs,
		roles: roleResults,
		matrix: buildMatrix(roleResults),
		summary: buildSummary(roleResults),
	};

	return aggregated;
}

/**
 * 5 Role aggregate から AC6 schema の matrix を構築
 *
 * POC では Role ごとの parse 成功結果を flatten。Phase 1 完成後は cross-role 一致判定で
 * agent_disagreement field を埋める。
 */
function buildMatrix(roleResults) {
	const matrix = [];
	for (const [roleName, agg] of Object.entries(roleResults)) {
		for (const sample of agg.samples) {
			// 各 role の出力 schema 別に flatten
			const items =
				sample.evaluations || sample.objections || sample.concerns || sample.violations || [];
			for (const item of items) {
				matrix.push({
					step: item.step ?? null,
					agent: roleName,
					heuristic_or_question:
						item.question || item.axis || item.violation_type || item.concern?.slice(0, 50) || '',
					result: item.result || (item.severity >= 3 ? 'Concern' : 'Yes'),
					severity: item.severity ?? item.revised_severity ?? 0,
					certainty: agg.certainty,
					evidence: item.evidence || item.reason || item.detail || item.concern || '',
				});
			}
		}
	}
	return matrix;
}

/**
 * summary section 構築 (AC6 schema)
 */
function buildSummary(roleResults) {
	let totalIssues = 0;
	let severity34Count = 0;
	let highCertaintyCount = 0;
	let lowCertaintyCount = 0;

	for (const agg of Object.values(roleResults)) {
		for (const sample of agg.samples) {
			const items =
				sample.evaluations || sample.objections || sample.concerns || sample.violations || [];
			totalIssues += items.length;
			for (const item of items) {
				const sev = item.severity ?? item.revised_severity ?? 0;
				if (sev >= 3) severity34Count++;
			}
		}
		// certainty 帯
		if (agg.certainty >= 0.7) highCertaintyCount++;
		else if (agg.certainty < 0.3) lowCertaintyCount++;
	}

	return {
		total_issues: totalIssues,
		severity_3_4_count: severity34Count,
		high_certainty_count: highCertaintyCount,
		low_certainty_count: lowCertaintyCount,
		false_positive_estimate_pct: 'POC naive 3 runs: 推定 25-35% (Phase 1 task #192 完成後に実測)',
	};
}

/**
 * 集約 JSON をファイルに保存
 */
export async function saveEvaluation(jsonPath, aggregated) {
	await fs.mkdir(dirname(jsonPath), { recursive: true });
	await fs.writeFile(jsonPath, JSON.stringify(aggregated, null, 2), 'utf-8');
}
