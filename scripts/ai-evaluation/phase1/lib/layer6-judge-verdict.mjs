/**
 * Layer F — Judge's Verdict Calibration (Cohen's Kappa + layer 重み付け) — Issue #2711 Phase 1.1
 *
 * 原理 (arXiv 2510.09738 Judge's Verdict):
 *   1. 各 layer 出力と ground truth (User 30 分実機操作) で Cohen's Kappa κ 実測
 *   2. κ 閾値で layer 重み調整 (Tier 1 model κ=0.753-0.813、本 POC 目標 ≥ 0.50 は保守的)
 *   3. confidence weighted aggregation で最終 finding を確定
 *
 * SSOT (逐語コピー元): tmp/round18-phase1-poc-design-2026-05-30.md §8 (Layer F 詳細 spec)
 *
 * 効果実証: Macro F1 97.6-98.4% consensus (arXiv 2510.09738)、Cohen's Kappa 0.753-0.813 Tier 1
 *
 * cost 試算 (Real mode): $0 (純 algorithm、LLM 呼出なし)
 *
 * 重み付け閾値 (Judge's Verdict thresholds):
 *   - κ ≥ 0.81 (almost perfect, Tier 1 top) → weight 1.0
 *   - κ ≥ 0.61 (substantial) → weight 0.85
 *   - κ ≥ 0.50 (moderate, Phase 1 目標下限) → weight 0.7
 *   - κ ≥ 0.20 (fair) → weight 0.3
 *   - κ < 0.20 (slight) → weight 0 (discard)
 */

/**
 * Cohen's Kappa = (p₀ - pₑ) / (1 - pₑ)
 *
 * 各 (step, heuristic, age_tier, viewport) を unique key として bool 化 (uphold/kill) で計算
 */
export function computeCohenKappa(groundTruth, aiOutput) {
	if (groundTruth.length === 0 && aiOutput.length === 0) return 1; // 両方 empty は完全一致
	const matchKey = (item) =>
		`${item.step ?? ''}|${item.heuristic ?? ''}|${item.age_tier ?? ''}|${item.viewport ?? ''}`;
	const gtKeys = new Set(groundTruth.map(matchKey));
	const aiKeys = new Set(aiOutput.map(matchKey));
	const allKeys = new Set([...gtKeys, ...aiKeys]);

	let n00 = 0;
	let n01 = 0;
	let n10 = 0;
	let n11 = 0;
	for (const key of allKeys) {
		const gt = gtKeys.has(key);
		const ai = aiKeys.has(key);
		if (gt && ai) n11++;
		else if (gt && !ai) n10++;
		else if (!gt && ai) n01++;
		else n00++;
	}

	const n = n00 + n01 + n10 + n11;
	if (n === 0) return 0;
	const p0 = (n00 + n11) / n;
	const pe = ((n00 + n01) * (n00 + n10) + (n10 + n11) * (n01 + n11)) / (n * n);
	if (pe === 1) return 0; // 全件 expected agreement = 1 は分母 0
	return (p0 - pe) / (1 - pe);
}

/**
 * κ 閾値で layer 重み判定 (Judge's Verdict thresholds)
 */
export function kappaToWeight(kappa) {
	if (kappa >= 0.81) return 1.0;
	if (kappa >= 0.61) return 0.85;
	if (kappa >= 0.5) return 0.7;
	if (kappa >= 0.2) return 0.3;
	return 0;
}

/**
 * 5 軸定量実測 (AC4 達成判定用)
 *
 * Severity 3-4 のみ集計 (本 POC 主目標域、severity 0-1 は cosmetic で除外)
 */
export function computeMetrics(groundTruth, aiOutput, userFilterTimeSeconds = 0) {
	const matchKey = (item) =>
		`${item.heuristic ?? ''}|${item.step ?? ''}|${item.cross_screen_unified ? 'ALL' : (item.age_tier ?? '')}`;
	const gt34 = groundTruth.filter((g) => (g.severity ?? 0) >= 3);
	const ai34 = aiOutput.filter((a) => (a.severity ?? 0) >= 3);

	const gtKeys = new Set(gt34.map(matchKey));
	const aiKeys = new Set(ai34.map(matchKey));

	const tp = [...aiKeys].filter((k) => gtKeys.has(k)).length;
	const fp = [...aiKeys].filter((k) => !gtKeys.has(k)).length;
	const fn = [...gtKeys].filter((k) => !aiKeys.has(k)).length;

	const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
	const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
	const fpRate = tp + fp > 0 ? fp / (tp + fp) : 0;
	const fnRate = tp + fn > 0 ? fn / (tp + fn) : 0;
	const kappa = computeCohenKappa(groundTruth, aiOutput);

	return {
		recall,
		precision,
		fp_rate: fpRate,
		fn_rate: fnRate,
		cohen_kappa: kappa,
		user_filter_time_min: userFilterTimeSeconds / 60,
		tp,
		fp,
		fn,
	};
}

/**
 * AC4 達成判定 path (5 軸全達成 → Phase 1.2 / 1-2 件未達 → 1.5 / 3+ 件未達 → 1-E)
 */
export function evaluateAchievementPath(metrics) {
	const checks = {
		recall: metrics.recall >= 0.7,
		precision_fp: metrics.fp_rate <= 0.2,
		fn: metrics.fn_rate <= 0.3,
		kappa: metrics.cohen_kappa >= 0.5,
		user_time: metrics.user_filter_time_min <= 30,
	};
	const passed = Object.values(checks).filter(Boolean).length;
	const failed = 5 - passed;

	let nextPhase;
	if (failed === 0) nextPhase = 'phase-1.2-five-to-ten-type-expansion';
	else if (failed <= 2) nextPhase = 'phase-1.5-deep-research-missing-axis';
	else nextPhase = 'phase-1-E-stack-rewind-adr';

	return {
		checks,
		passed,
		failed,
		next_phase: nextPhase,
	};
}

/**
 * Layer F run (calibration、Real / Mock 両対応)
 */
export async function runLayerF({
	layerEOutput,
	groundTruth = [],
	userFilterTimeSeconds = 0,
	layerOutputs = {},
	mock = false,
}) {
	const finalFindings = layerEOutput.aggregated || [];

	// Mock では ground truth を AI output 90% に近い stub から生成 (κ 0.5-0.7 域 simulate)
	const effectiveGroundTruth =
		groundTruth.length > 0
			? groundTruth
			: mock
				? finalFindings.slice(0, Math.ceil(finalFindings.length * 0.9)).map((f, i) => ({
						...f,
						id: `gt-mock-${i}`,
						severity: f.severity ?? f.avg_severity ?? 3, // ground truth は明確 severity
					}))
				: [];

	const metrics = computeMetrics(effectiveGroundTruth, finalFindings, userFilterTimeSeconds);

	// 各 layer の κ を実測 (mock では sample で simulate)
	const layerKappa = {};
	const layerWeights = {};
	for (const [layerKey, output] of Object.entries(layerOutputs)) {
		const layerFindings = output.aggregated || [];
		const k = computeCohenKappa(effectiveGroundTruth, layerFindings);
		layerKappa[layerKey] = k;
		layerWeights[layerKey] = kappaToWeight(k);
	}

	const achievement = evaluateAchievementPath(metrics);

	console.log(
		`[layer-f] κ=${metrics.cohen_kappa.toFixed(3)} recall=${(metrics.recall * 100).toFixed(1)}% precision=${(metrics.precision * 100).toFixed(1)}% (FP=${(metrics.fp_rate * 100).toFixed(1)}%)`,
	);
	console.log(
		`[layer-f] achievement: ${achievement.passed}/5 PASS → next: ${achievement.next_phase}`,
	);

	return {
		layer: 'F',
		findings_in: finalFindings.length,
		findings_out: finalFindings.length, // Layer F は計測のみで kill しない
		metrics,
		layer_kappa: layerKappa,
		layer_weights: layerWeights,
		achievement,
		aggregated: finalFindings,
	};
}
