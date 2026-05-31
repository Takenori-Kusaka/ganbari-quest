/**
 * Layer E — Synthetic Heuristic Evaluation + FP 3 類型対策 — Issue #2711 Phase 1.1
 *
 * 原理 (arXiv 2507.02306 Synthetic HE):
 *   1. Nielsen 10 原則 × 5 step matrix を split prompt (1-5 / 6-10) で並列実行 (token limit 対応)
 *   2. terms.ts atom SSOT full injection (FP 類型 1「UI Component Recognition Errors」抑制)
 *   3. 5 age tier 全件 capture で cross-screen aggregation (FP 類型 3 抑制)
 *   4. cosine similarity 0.85+ で dedup (cross-screen 5 件 → 1 件集約)
 *
 * SSOT (逐語コピー元): tmp/round18-phase1-poc-design-2026-05-30.md §7 (Layer E 詳細 spec)
 *
 * 重要修正 (Round 18 deep research): arXiv 2507.02306 73-77% は **Recall** であって FP 率ではない。
 *   Synthetic HE のFP率は 42-52% (Round 17 で誤読 → 本 Round で honest 修正)。
 *   本 Layer は Recall 改善 (+15-25pt detection) を担当、FP 抑制は Layer C/D が主担保。
 *
 * cost 試算 (Real mode): $6-15
 *   - Split prompt 1-5 / 6-10 並列実行: $3-7 × 2 = $6-14
 *   - Dedup embedding: $0.5-1
 */

// biome-ignore lint/correctness/noUnusedVariables: Phase 1.2 実装用 SSOT (#2711) — Real mode の split prompt (1-5 / 6-10) に逐語埋め込み
const NIELSEN_HEURISTICS = {
	'1-5': [
		'1. Visibility of system status',
		'2. Match between system and the real world',
		'3. User control and freedom',
		'4. Consistency and standards',
		'5. Error prevention',
	],
	'6-10': [
		'6. Recognition rather than recall',
		'7. Flexibility and efficiency of use',
		'8. Aesthetic and minimalist design',
		'9. Help users recognize, diagnose, recover from errors',
		'10. Help and documentation',
	],
};

/**
 * Mock split prompt response (heuristics 1-5 / 6-10 別)
 */
function buildMockSplitResponse(heuristicRange, candidates) {
	const baseFindings = candidates.slice(0, 4).map((c, i) => ({
		id: `mock-l5-${heuristicRange}-${i}`,
		heuristic: heuristicRange === '1-5' ? (i % 5) + 1 : (i % 5) + 6,
		step: c.step ?? (i % 5) + 1,
		age_tier: c.age_tier ?? 'elementary',
		viewport: c.viewport ?? 'mobile',
		result: i % 3 === 0 ? 'No' : 'Partial',
		severity: ((c.severity ?? c.avg_severity ?? 2) + i) % 5,
		rationale: `Synthetic HE H${heuristicRange === '1-5' ? (i % 5) + 1 : (i % 5) + 6} 観点で finding。${c.rationales?.[0]?.slice(0, 60) ?? c.rationale?.slice(0, 60) ?? '本 product 子供向け context'}`,
		evidence_ss_name:
			c.evidence_ss_name ?? `mock-${c.age_tier ?? 'elementary'}-step${c.step ?? 1}.webp`,
		evidence_term_quote: c.evidence_term_quote ?? 'N/A',
		confidence: 0.6,
		cross_screen_unified: i % 4 === 0, // 25% が cross-screen 集約済
	}));
	return baseFindings;
}

/**
 * Cosine similarity 簡易実装 (Mock 用、Real は OpenAI / Anthropic embeddings API)
 *
 * Mock では文字列の Jaccard 類似度で近似 (Phase 1.2 で本格 embedding に upgrade)
 */
function mockCosineSimilarity(a, b) {
	const tokensA = new Set(a.toLowerCase().split(/\s+|、|。/));
	const tokensB = new Set(b.toLowerCase().split(/\s+|、|。/));
	const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
	const union = new Set([...tokensA, ...tokensB]);
	return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Cross-screen aggregation dedup (cosine similarity 0.85+ で merge)
 */
export function deduplicateAcrossScreens(findings, opts = { similarityThreshold: 0.85 }) {
	const groups = [];
	for (const f of findings) {
		let assigned = false;
		for (const group of groups) {
			const sim = mockCosineSimilarity(f.rationale, group[0].rationale);
			if (
				f.heuristic === group[0].heuristic &&
				f.step === group[0].step &&
				sim >= opts.similarityThreshold
			) {
				group.push(f);
				assigned = true;
				break;
			}
		}
		if (!assigned) groups.push([f]);
	}
	return groups.map((group) => ({
		...group[0],
		cross_screen_unified: true,
		affected_age_tiers: [...new Set(group.map((f) => f.age_tier))],
		aggregated_count: group.length,
	}));
}

/**
 * Layer E run (Real / Mock 両対応)
 */
export async function runLayerE({
	layerDOutput,
	mock = false,
	// Phase 1.2 Real mode 実装互換性維持のため interface 保持 (#2711)
	anthropicApiKey: _anthropicApiKey,
	model: _model = 'claude-opus-4-7',
}) {
	const candidates = layerDOutput.aggregated || [];

	if (mock) {
		console.log(`[layer-e] MOCK mode: ${candidates.length} candidates で Nielsen 10 split prompt`);
		// Split prompt 1-5 / 6-10 を「並列」simulate
		const findings1to5 = buildMockSplitResponse('1-5', candidates);
		const findings6to10 = buildMockSplitResponse('6-10', candidates);

		// Dedup cross-screen
		const allFindings = [...findings1to5, ...findings6to10];
		const deduplicated = deduplicateAcrossScreens(allFindings, { similarityThreshold: 0.85 });

		console.log(
			`[layer-e] heuristic 1-5: ${findings1to5.length}件 / 6-10: ${findings6to10.length}件 / dedup 後: ${deduplicated.length}件`,
		);

		return {
			layer: 'E',
			split_prompt: {
				'1-5': findings1to5.length,
				'6-10': findings6to10.length,
			},
			findings_in: candidates.length,
			findings_out: deduplicated.length,
			dedup_reduction:
				allFindings.length > 0
					? (allFindings.length - deduplicated.length) / allFindings.length
					: 0,
			aggregated: deduplicated,
		};
	}

	throw new Error(`[layer-e] Real mode は Phase 1.2 で実装予定`);
}
