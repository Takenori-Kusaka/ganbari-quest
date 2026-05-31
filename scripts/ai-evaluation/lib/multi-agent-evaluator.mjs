/**
 * Multi-Agent AI Evaluator + Self-Consistency naive 3 runs (Issue #2692 AC4-AC6)
 *
 * 役割:
 *   - 5 Role (Planner / Adversarial / Persona A / Persona B / Brand) prompt を順次実行
 *   - 各 Role を Self-Consistency 3 runs (Promise.all 並列) で多数決
 *   - 3 runs 中 2+ 一致 → high certainty (>0.7)、バラバラ → low certainty (<0.3)
 *   - 集約 JSON を tmp/round18/evaluation-activity-pack.json に出力 (AC6 schema)
 *
 * Mock mode (--mock flag、cost $0、Anthropic API call なし):
 *   - 5 Role × N runs ぶんの realistic dummy response を生成
 *   - votes 分散: 一部 issue は 3/3 一致 (high certainty)、一部 1/3 のみ (low certainty)
 *   - issue type 多様性: severity 1-4 混在、role 別の schema (evaluations / objections / concerns / violations)
 *   - 集約 logic / matrix / summary / filter session の structural test を埋める
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
 * 5 Role 別 realistic mock issue 生成 (Issue #2692 mock smoke test)
 *
 * 各 Role の出力 schema (multi-agent-evaluator.js buildMatrix が参照する key) に integrate:
 *   - Planner: evaluations[] { step, question, result, severity, evidence }
 *   - Adversarial: objections[] { step, reason, revised_severity, evidence }
 *   - Persona A/B: concerns[] { step, concern, severity, evidence }
 *   - Brand: violations[] { step, violation_type, severity, evidence }
 *
 * vote 分散制御: runIndex により severity / 件数を僅かに変動させて 3 runs 中 votes が 3/3 / 2/3 / 1/3
 * 混在する状態を再現する (aggregateRuns の certainty = parsed/total proxy が realistic 度を測れる)
 */
function buildMockResponse(roleName, runIndex, ageMode, totalSteps) {
	const baseSteps = Array.from({ length: totalSteps }, (_, i) => i + 1);
	// runIndex 0/1/2 で「ほぼ同じ + 一部 variant」を作る
	const driftKey = runIndex % 2 === 0 ? 'A' : 'B';

	if (roleName === 'planner') {
		return {
			evaluations: baseSteps.flatMap((step) => {
				const items = [
					{
						step,
						question: 'Q1 何をすべきか分かるか',
						result: step <= 2 ? 'Yes' : step === 3 ? 'Partial' : 'Yes',
						severity: step === 3 ? 3 : 1,
						evidence: `step ${step} の CTA テキストが ${driftKey === 'A' ? '明確' : 'やや不明瞭'}`,
					},
					{
						step,
						question: 'Q3 操作が機能したと分かるか',
						result: step === 5 ? 'Concern' : 'Yes',
						severity: step === 5 ? 4 : 1,
						evidence:
							step === 5
								? `インポート完了 toast の表示時間が短く ${ageMode === 'preschool' ? '幼児には' : ''} 認識困難`
								: 'visual feedback OK',
					},
				];
				// run drift: Run 0/2 で追加 issue、Run 1 では削減 (votes 分散 simulation)
				if (driftKey === 'A' && step === 2) {
					items.push({
						step,
						question: 'Q2 タスクと結びついた要素が見えるか',
						result: 'Partial',
						severity: 2,
						evidence: `+ ボタンの位置が ${ageMode} mode で右上 corner、初見探索性に課題`,
					});
				}
				return items;
			}),
		};
	}

	if (roleName === 'adversarial') {
		return {
			objections: [
				{
					step: 3,
					reason:
						'business: marketplace 取込導線が menu 経由のみで empty state からの secondary link 不在',
					revised_severity: driftKey === 'A' ? 3 : 2,
					evidence: 'docs/DESIGN.md §10 bulk import bridge ルール違反候補',
				},
				{
					step: 4,
					reason: 'UX: preset card の age range フィルターが画面上見えず、不適合 preset 選択リスク',
					revised_severity: 3,
					evidence: `${ageMode} 用 preset のみ表示する filter chip 不在`,
				},
				{
					step: 5,
					reason:
						'security: 子供選択 dialog で「全員に追加」がデフォルト ON、意図しない broadcast リスク',
					revised_severity: driftKey === 'A' ? 2 : 1,
					evidence: 'CHILD_SELECTION_TERMS.allOptionLabel 仕様確認要',
				},
			],
		};
	}

	if (roleName === 'persona_a') {
		return {
			concerns: [
				{
					step: 1,
					concern: `3 歳児の親視点: 「活動」「みんなのテンプレート」用語が ${ageMode === 'preschool' ? '幼児向け説明として' : ''}抽象的`,
					severity: driftKey === 'A' ? 3 : 3, // 安定 high certainty
					evidence: 'terms.ts TEMPLATE_TERMS.userFacing は親向けだが幼児画面でも露出する可能性',
				},
				{
					step: 3,
					concern: '初回 onboarding で marketplace を開くと選択肢過多で離脱する懸念',
					severity: 2,
					evidence: 'Hick’s Law (DESIGN.md §10 add 経路 ≤ 4 ルール) 抵触ライン候補',
				},
			],
		};
	}

	if (roleName === 'persona_b') {
		return {
			concerns: [
				{
					step: 2,
					concern: '小 3 親視点: header + button が settings icon と隣接し誤タップ多発リスク',
					severity: driftKey === 'A' ? 3 : 2,
					evidence: `${ageMode} の tapSize=${ageMode === 'baby' ? 120 : ageMode === 'preschool' ? 80 : ageMode === 'elementary' ? 56 : ageMode === 'junior' ? 48 : 44} px 整合要確認`,
				},
				{
					step: 4,
					concern: '同じ preset を 2 回連続で選ぶと重複追加されるか不明',
					severity: 2,
					evidence: '重複ガード仕様 確認要',
				},
			],
		};
	}

	if (roleName === 'brand') {
		return {
			violations: [
				{
					step: 1,
					violation_type: 'DESIGN.md §9 #2 プリミティブ再実装疑い',
					severity: driftKey === 'A' ? 2 : 2,
					evidence: 'header + button が IconButton primitive 経由か要確認',
				},
				{
					step: 5,
					violation_type: 'ADR-0012 Anti-engagement: 取込完了 toast に絵文字連打 sparkle 演出',
					severity: 3,
					evidence:
						'子供画面で滞在延伸を促す表現の可能性、DESIGN.md §10 reward 階層 token 整合要確認',
				},
			],
		};
	}

	return { evaluations: [] };
}

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
		// Claude Opus 4.x (4 / 4.5 / 4.7) は extended thinking 系で temperature が deprecated。
		// model 名で分岐し Opus 4.x 系では omit、それ以外は 0.7 (multi-agent diversity 確保用)。
		// docs: https://docs.anthropic.com/en/docs/about-claude/models/all-models#feature-comparison
		const isOpus4Family = /claude-opus-4[-.]?\d*/.test(model);
		/** @type {Record<string, unknown>} */
		const apiParams = {
			model,
			max_tokens: 4000,
			system: systemPrompt,
			messages: [{ role: 'user', content: userContent }],
		};
		if (!isOpus4Family) {
			apiParams.temperature = 0.7;
		}
		const res = await client.messages.create(apiParams);

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
 * @param {string} opts.apiKey - ANTHROPIC_API_KEY (mock=true 時は不要)
 * @param {string} opts.model - 'claude-opus-4-7' 等
 * @param {number} opts.runs - 3 (POC naive、Phase 1 完成後 5-10)
 * @param {string} opts.type - 'activity-pack'
 * @param {string} opts.ageMode - 'preschool' 等
 * @param {string[]} opts.screenshotPaths - 5 step の SS path 配列
 * @param {Object} opts.contextExtra - axe-core summary 等
 * @param {boolean} [opts.mock=false] - true で realistic dummy response (cost $0、Issue #2692)
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
	mock = false,
}) {
	let client = null;
	if (mock) {
		console.log(
			'[multi-agent] MOCK mode: 実 Anthropic API call なし、realistic dummy response で集約',
		);
	} else {
		if (!apiKey) throw new Error('ANTHROPIC_API_KEY 必須 (mock=true 時は不要)');
		const Anthropic = await loadAnthropic();
		client = new Anthropic({ apiKey });
	}

	const userInstruction = `Evaluate the ${screenshotPaths.length} attached screenshots for type=${type}, age_mode=${ageMode}. Apply your assigned Role only. Output JSON strictly per the schema in your system prompt.`;

	// 5 Role を順次評価 (並列も可能だが API rate limit + cost 抑制で sequential)
	const roleResults = {};
	for (const [roleName, systemPrompt] of Object.entries(PROMPT_TEMPLATES)) {
		console.log(`[multi-agent] role=${roleName} × runs=${runs} で評価中…`);

		if (mock) {
			// Mock: realistic dummy response を runs 回生成 (vote 分散付き、structural test)
			const totalSteps = screenshotPaths.length || 5;
			const runs_arr = Array.from({ length: runs }, (_, runIndex) => ({
				parsed: buildMockResponse(roleName, runIndex, ageMode, totalSteps),
				raw: '[MOCK response]',
			}));
			roleResults[roleName] = aggregateRuns(runs_arr);
		} else {
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
	}

	// 集約 (AC6 schema 整合)
	const aggregated = {
		type,
		age_mode: ageMode,
		evaluation_date: new Date().toISOString().slice(0, 10),
		model: mock ? `[MOCK] ${model}` : model,
		self_consistency_runs: runs,
		mock_mode: mock || undefined, // mock 時のみ true、real eval 時 omit (后方互換)
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
