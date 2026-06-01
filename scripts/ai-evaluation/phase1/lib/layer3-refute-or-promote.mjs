/**
 * Layer C — Refute-or-Promote Stage-Gated (本 Round 主担保) — Issue #2711 Phase 1.1
 *
 * 原理 (arXiv 2604.19049 RoP = Refute-or-Promote):
 *   Stage A: 1 creative + 2 adversarial (Claude Sonnet 4-6 並列)
 *     - 2 adversarial kill → eliminated (stage-a-killed)
 *     - 2 adversarial uphold + creative uphold → survived-stage-a
 *     - mixed → escalate-to-stage-b
 *   Stage B: 2 creative + 3 adversarial (1 senior tier = Opus 4-7)
 *     - effective kills (adv + senior weight) ≥ 3 → killed-stage-b
 *     - それ未満 → survived-stage-b
 *   Stage D: Cross-Model Critic (Gemini 2.5 Pro、別 model family で anchoring bias 抑制)
 *     - kill → final-kill, survive → final-uphold
 *
 * SSOT (逐語コピー元): tmp/round18-phase1-poc-design-2026-05-30.md §5 (Layer C 詳細 spec)
 *
 * 効果実証: arXiv 2604.19049 で 79% kill rate (本 Round 主担保 layer)
 *           本 product 適用は未実証、Phase 1.1 POC で初実証
 *
 * cost 試算 (Real mode): $8-21
 *   - Stage A: 3 agents × N candidates → $3-8
 *   - Stage B: 5 agents × M escalated (≈ 0.3 * N) → $4-10
 *   - Stage D: 1 Gemini × K survivors (≈ 0.4 * N) → $1-3
 *
 * Adversarial track の重要制約 (anchoring 抑止):
 *   - Creative の reasoning は context に含めない
 *   - SS も提供しない (claim 文面のみで判定)
 *   - reachability concern + precondition concern の 2 軸精査
 */

/**
 * Mock Stage A response
 *
 * 79% kill rate を再現するため、candidate 数の 60-70% を Stage A で kill、20-30% を escalate
 *
 * @param {Array<Record<string, any>>} candidates
 * @returns {{stage: string, killed: Array<Record<string, any>>, survived: Array<Record<string, any>>, escalated: Array<Record<string, any>>}}
 */
function buildMockStageA(candidates) {
	const results = candidates.map((c, i) => {
		// 60% Stage A kill / 20% Stage A survive / 20% escalate-to-stage-b
		const fate = i % 5;
		if (fate < 3) return { candidate: c, status: 'killed-stage-a', stage: 'A' };
		if (fate === 3) return { candidate: c, status: 'survived-stage-a', stage: 'A' };
		return { candidate: c, status: 'escalated-to-stage-b', stage: 'A' };
	});
	return {
		stage: 'A',
		killed: results.filter((r) => r.status === 'killed-stage-a').map((r) => r.candidate),
		survived: results.filter((r) => r.status === 'survived-stage-a').map((r) => r.candidate),
		escalated: results.filter((r) => r.status === 'escalated-to-stage-b').map((r) => r.candidate),
	};
}

/**
 * Mock Stage B response (escalated のみ評価)
 *
 * Stage B では senior tier weight 込みで effective kills ≥ 3 → 50% kill 想定
 *
 * @param {Array<Record<string, any>>} escalated
 * @returns {{stage: string, killed: Array<Record<string, any>>, survived: Array<Record<string, any>>}}
 */
function buildMockStageB(escalated) {
	const results = escalated.map((c, i) => ({
		candidate: c,
		status: i % 2 === 0 ? 'killed-stage-b' : 'survived-stage-b',
		stage: 'B',
	}));
	return {
		stage: 'B',
		killed: results.filter((r) => r.status === 'killed-stage-b').map((r) => r.candidate),
		survived: results.filter((r) => r.status === 'survived-stage-b').map((r) => r.candidate),
	};
}

/**
 * Mock Stage D Cross-Model Critic (Gemini 2.5 Pro)
 *
 * Stage A/B survived → Cross-Model 独立批判 → 25% kill 想定
 *
 * @param {Array<Record<string, any>>} survivors
 * @returns {{stage: string, killed: Array<Record<string, any>>, survived: Array<Record<string, any>>, skipped?: boolean}}
 */
function buildMockStageD(survivors) {
	const results = survivors.map((c, i) => ({
		candidate: c,
		verdict: i % 4 === 0 ? 'kill' : 'survive',
		stage: 'D',
		cross_model_reasoning: `[Cross-Model 100+ 文字] Gemini 2.5 Pro 視点で Anthropic Claude 系の constitutional AI 訓練バイアスを疑う。本 product Pre-PMF + 子供向け文脈で finding は ${i % 4 === 0 ? 'over-reach、kill 推奨' : '妥当、uphold'}`,
	}));
	return {
		stage: 'D',
		killed: results.filter((r) => r.verdict === 'kill').map((r) => r.candidate),
		survived: results.filter((r) => r.verdict === 'survive').map((r) => r.candidate),
	};
}

/**
 * Layer C run (Real / Mock 両対応)
 *
 * @param {Object} opts
 * @param {{aggregated?: Array<Record<string, any>>}} opts.layerBOutput
 * @param {boolean} [opts.mock]
 * @param {string|undefined} [opts.anthropicApiKey]
 * @param {string|undefined} [opts.geminiApiKey]
 * @param {string[]} [opts.screenshotPaths]
 * @returns {Promise<Record<string, any>>}
 */
export async function runLayerC({
	layerBOutput,
	mock = false,
	// Phase 1.2 Real mode 実装互換性維持のため interface 保持 (#2711)
	anthropicApiKey: _anthropicApiKey,
	geminiApiKey,
	screenshotPaths: _screenshotPaths = [],
}) {
	const candidates = layerBOutput.aggregated || [];

	if (mock) {
		console.log(`[layer-c] MOCK mode: ${candidates.length} candidates から 3 stage RoP`);
		const stageA = buildMockStageA(candidates);
		console.log(
			`[layer-c] Stage A: killed=${stageA.killed.length} survived=${stageA.survived.length} escalated=${stageA.escalated.length}`,
		);

		const stageB = buildMockStageB(stageA.escalated);
		console.log(
			`[layer-c] Stage B: killed=${stageB.killed.length} survived=${stageB.survived.length}`,
		);

		const stageDInput = [...stageA.survived, ...stageB.survived];
		// geminiApiKey 未配備の Mock 時は skip 想定 simulate (cost 削減 fallback)
		/** @type {{stage: string, killed: Array<Record<string, any>>, survived: Array<Record<string, any>>, skipped?: boolean}} */
		const stageD =
			geminiApiKey === 'mock-disabled'
				? { stage: 'D', killed: [], survived: stageDInput, skipped: true }
				: buildMockStageD(stageDInput);
		if (!stageD.skipped) {
			console.log(
				`[layer-c] Stage D: killed=${stageD.killed.length} survived=${stageD.survived.length}`,
			);
		}

		const totalCandidates = candidates.length;
		const totalKills = stageA.killed.length + stageB.killed.length + (stageD.killed?.length || 0);
		const killRate = totalCandidates > 0 ? totalKills / totalCandidates : 0;
		console.log(
			`[layer-c] kill rate: ${(killRate * 100).toFixed(1)}% (target arXiv 2604.19049: 60-80%)`,
		);

		return {
			layer: 'C',
			stages: {
				A: {
					killed: stageA.killed.length,
					survived: stageA.survived.length,
					escalated: stageA.escalated.length,
				},
				B: { killed: stageB.killed.length, survived: stageB.survived.length },
				D: {
					killed: stageD.killed?.length || 0,
					survived: stageD.survived.length,
					skipped: stageD.skipped || false,
				},
			},
			findings_in: totalCandidates,
			findings_out: stageD.survived.length,
			kill_rate: killRate,
			aggregated: stageD.survived,
		};
	}

	// Real mode: TODO Phase 1.2 で実装
	throw new Error(`[layer-c] Real mode は Phase 1.2 で実装予定`);
}
