/**
 * Layer B — Multi-Agent Debate with KS-test Adaptive Stability — Issue #2711 Phase 1.1
 *
 * 原理 (arXiv 2510.12697 NeurIPS 2025):
 *   1. 3 agent debate: Planner (cognitive-walkthrough Skill) + Heuristic Evaluator (Synthetic HE) +
 *      Adversarial Reviewer (adversarial-reviewer Skill / ADR-0056)
 *   2. 各 round 後に Kolmogorov-Smirnov 2-sample test (severity distribution の最大 CDF 差)
 *   3. ε=0.05 threshold で 2 consecutive rounds 未満 → adaptive stop
 *   4. 最大 5 rounds で打ち切り (cost gate)
 *
 * SSOT (逐語コピー元): tmp/round18-phase1-poc-design-2026-05-30.md §4 (Layer B 詳細 spec)
 *
 * 効果実証: arXiv 2510.12697 で +1.93 〜 4.08pt accuracy (LLMBar / TruthfulQA / JudgeBench)
 *           FN +5-10% の副作用あり (debate amplification)
 *
 * cost 試算 (Real mode): $5-15 (Per-agent input ~10K tokens cache hit、3 agents × 3-5 rounds)
 */

const KS_THRESHOLD = 0.05; // arXiv 2510.12697 公式 spec
// biome-ignore lint/correctness/noUnusedVariables: Phase 1.2 実装用 SSOT (#2711) — shouldStopDebate の window=3 (= consecutive 2 KS-tests) 算出根拠
const CONSECUTIVE_ROUNDS_FOR_STOP = 2;
const MAX_ROUNDS = 5;

/**
 * KS 2-sample test (severity distribution の最大 CDF 差)
 * @param {number[]} s1
 * @param {number[]} s2
 * @returns {number}
 */
export function ksTwoSample(s1, s2) {
	if (s1.length === 0 && s2.length === 0) return 0;
	if (s1.length === 0 || s2.length === 0) return 1;
	const sorted1 = [...s1].sort((a, b) => a - b);
	const sorted2 = [...s2].sort((a, b) => a - b);
	const allValues = [...new Set([...sorted1, ...sorted2])].sort((a, b) => a - b);
	let maxDiff = 0;
	for (const v of allValues) {
		const cdf1 = sorted1.filter((x) => x <= v).length / sorted1.length;
		const cdf2 = sorted2.filter((x) => x <= v).length / sorted2.length;
		maxDiff = Math.max(maxDiff, Math.abs(cdf1 - cdf2));
	}
	return maxDiff;
}

/**
 * Adaptive stop 判定: 直近 3 round の severity distribution KS-test が 2 consecutive ε 未満
 * @param {Array<Array<{findings?: Array<{severity?: number}>}>>} history
 * @returns {boolean}
 */
export function shouldStopDebate(history) {
	if (history.length < 3) return false;
	const latestRound = history[history.length - 1];
	const prev1Round = history[history.length - 2];
	const prev2Round = history[history.length - 3];
	if (!latestRound || !prev1Round || !prev2Round) return false;
	const latest = latestRound.flatMap((r) => (r.findings || []).map((f) => f.severity ?? 0));
	const prev1 = prev1Round.flatMap((r) => (r.findings || []).map((f) => f.severity ?? 0));
	const prev2 = prev2Round.flatMap((r) => (r.findings || []).map((f) => f.severity ?? 0));
	const ks1 = ksTwoSample(latest, prev1);
	const ks2 = ksTwoSample(prev1, prev2);
	return ks1 < KS_THRESHOLD && ks2 < KS_THRESHOLD;
}

/**
 * Mock agent response 生成 (3 agent 別 schema)
 *
 * Round 進行で findings が収束する pattern を simulate:
 *   - Round 0: 多めの finding
 *   - Round 1: KS shift → severity 修正
 *   - Round 2-3: KS-test ε 未満 → adaptive stop trigger
 *
 * @param {string} role
 * @param {number} round
 * @param {Array<Record<string, any>>} candidates
 * @returns {Record<string, any>}
 */
function buildMockAgentResponse(role, round, candidates) {
	const noise = round >= 2 ? 0 : 0.1 * (2 - round); // round 進行で noise 削減

	if (role === 'planner') {
		return {
			agent_role: 'planner',
			round,
			findings: candidates.slice(0, 3).map((c, i) => ({
				id: `mock-l2-planner-${round}-${i}`,
				step: c.step,
				age_tier: c.age_tier,
				viewport: c.viewport,
				heuristic: c.heuristic,
				severity: Math.max(0, Math.round(c.avg_severity + noise * (i - 1))),
				rationale: `Planner round ${round}: NN/G Q${(i % 4) + 1} 観点 — ${c.rationales?.[0]?.slice(0, 50) ?? 'flow check'}`,
				confidence: 0.6 + 0.1 * round, // round 進行で confidence 上昇
			})),
		};
	}

	if (role === 'heuristic_evaluator') {
		return {
			agent_role: 'heuristic_evaluator',
			round,
			findings: candidates.slice(0, 3).map((c, i) => ({
				id: `mock-l2-heur-${round}-${i}`,
				step: c.step,
				age_tier: c.age_tier,
				viewport: c.viewport,
				heuristic: c.heuristic,
				severity: c.avg_severity,
				rationale: `HE round ${round}: Nielsen H${c.heuristic} 観点で severity ${c.avg_severity} 妥当`,
				confidence: 0.7,
			})),
		};
	}

	if (role === 'adversarial_reviewer') {
		// ADR-0056 must_object_count: 3 schema 強制
		return {
			agent_role: 'adversarial_reviewer',
			round,
			objections: candidates.slice(0, Math.min(2, candidates.length)).flatMap((c, i) => [
				{
					axis: 'business',
					reason: `[business 軸 反対 100+ 文字] step ${c.step} の finding は automated CI で検出可能、AI 重複指摘の疑い。本 product DESIGN.md §9 5 禁忌のうち hex 直書き / 用語ハードコード / インラインスタイルは既機械化済のため Layer C で kill 候補`,
					target_finding_id: `mock-l2-heur-${round}-${i}`,
				},
				{
					axis: 'UX',
					reason: `[UX 軸 反対 100+ 文字] severity ${c.avg_severity} は 5 age tier (baby/preschool/elementary/junior/senior) のうち 1 tier の影響のみで cross-tier 集約が不完全な疑い。本 product Pre-PMF 期で全 tier 同等 severity 適用は過剰検出`,
					target_finding_id: `mock-l2-heur-${round}-${i}`,
				},
				{
					axis: 'security',
					reason: `[security 軸 反対 100+ 文字] step ${c.step} の UI 操作は ADR-0048 demo Lambda env (AUTH_MODE=anonymous + DATA_SOURCE=demo) で fixture child 901-906 で再現確認、本番 cognito 認証 flow とは別経路のため security implication なし、過剰警告の疑い`,
					target_finding_id: `mock-l2-heur-${round}-${i}`,
				},
			]),
			kills:
				round >= 2 ? candidates.slice(0, 1).map((_c, i) => `mock-l2-heur-${round - 1}-${i}`) : [],
			upholds: candidates.slice(1, 2).map((_, i) => `mock-l2-heur-${round}-${i + 1}`),
		};
	}

	return { agent_role: role, round, findings: [] };
}

/**
 * Layer B run (Real / Mock 両対応)
 *
 * @param {Object} opts
 * @param {{aggregated: Array<Record<string, any>>}} opts.layerAOutput
 * @param {number} [opts.runs]
 * @param {string} [opts.model]
 * @param {boolean} [opts.mock]
 * @param {string|undefined} [opts.anthropicApiKey]
 * @param {string[]} [opts.screenshotPaths]
 * @param {Record<string, string>} [opts.systemPromptByRole]
 * @param {string} [opts.userInstruction]
 * @returns {Promise<{layer: string, aggregated: Array<Record<string, any>>, findings_in: number, findings_out: number, kill_rate: number, rounds_executed?: number, max_rounds?: number, adaptive_stop_triggered?: boolean, adversarial_objections?: Array<any>}>}
 */
export async function runLayerB({
	layerAOutput,
	// Phase 1.2 Real mode 実装互換性維持のため interface 保持 (#2711)
	runs: _runs = 1, // round 内の Self-Consistency は本 layer 不要 (debate 自体が diversity)
	model: _model = 'claude-opus-4-7',
	mock = false,
	anthropicApiKey: _anthropicApiKey,
	screenshotPaths: _screenshotPaths = [],
	systemPromptByRole: _systemPromptByRole = {},
	userInstruction: _userInstruction = '',
}) {
	const candidates = layerAOutput.aggregated.filter((f) => f.escalate_to === 'layer-bc');

	if (mock) {
		console.log(
			`[layer-b] MOCK mode: ${candidates.length} candidates から debate (max ${MAX_ROUNDS} rounds)`,
		);
		/** @type {Array<Array<Record<string, any>>>} */
		const history = [];
		let stoppedAtRound = MAX_ROUNDS;
		for (let t = 0; t < MAX_ROUNDS; t++) {
			const round = [
				buildMockAgentResponse('planner', t, candidates),
				buildMockAgentResponse('heuristic_evaluator', t, candidates),
				buildMockAgentResponse('adversarial_reviewer', t, candidates),
			];
			history.push(round);
			if (shouldStopDebate(history)) {
				stoppedAtRound = t + 1;
				console.log(`[layer-b] KS-test converged at round ${stoppedAtRound}`);
				break;
			}
		}

		// 最終 round の majority + adversarial kills 反映
		const finalRound = history[history.length - 1];
		if (!finalRound) {
			throw new Error('[layer-b] history が空です (MAX_ROUNDS=0?)');
		}
		const advReviewer = finalRound.find((r) => r.agent_role === 'adversarial_reviewer');
		/** @type {Set<string>} */
		const killSet = new Set(advReviewer?.kills || []);
		const finalFindings = finalRound
			.filter((r) => r.findings)
			.flatMap((r) => r.findings || [])
			.filter((/** @type {{id: string}} */ f) => !killSet.has(f.id));

		return {
			layer: 'B',
			rounds_executed: stoppedAtRound,
			max_rounds: MAX_ROUNDS,
			adaptive_stop_triggered: stoppedAtRound < MAX_ROUNDS,
			findings_in: candidates.length,
			findings_out: finalFindings.length,
			kill_rate:
				candidates.length > 0 ? (candidates.length - finalFindings.length) / candidates.length : 0,
			aggregated: finalFindings,
			adversarial_objections: advReviewer?.objections || [],
		};
	}

	// Real mode: TODO Phase 1.2 で実装。本 PR は Mock smoke pass まで。
	throw new Error(
		`[layer-b] Real mode は Phase 1.2 で実装予定 (AC3、User 承認後 opt-in)。現状は --mock のみ動作。`,
	);
}
