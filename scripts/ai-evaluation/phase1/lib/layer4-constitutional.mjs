/**
 * Layer D — Constitutional Critique (本 product principle P1-P7 焼込み) — Issue #2711 Phase 1.1
 *
 * 原理 (arXiv 2502.15861 C3AI + NVIDIA NeMo CAI):
 *   本 product unique principle (P1-P7) を constitution.yml に焼込み、各 finding に critique loop。
 *   いずれか principle violates=true → kill、全 OK → uphold + revised_severity
 *
 * SSOT (逐語コピー元): tmp/round18-phase1-poc-design-2026-05-30.md §6 (Layer D 詳細 spec)
 *
 * Principle 一覧 (本 Round 起草):
 *   P1: DESIGN.md §9 5 点禁忌の機械化済対象を AI 重複指摘禁止
 *   P2: ADR-0012 Anti-engagement 原則 (engagement 推奨 finding は kill)
 *   P3: ADR-0045 terms.ts atom SSOT (atom 用語批判は FP)
 *   P4: 5 age tier (baby/preschool/elementary/junior/senior) 整合性 (age-tier mismatch は FP)
 *   P5: ADR-0010 Pre-PMF 過剰防衛回避 (大規模 testing / 国際化要求は severity 降格)
 *   P6: 子供向け UI 評価の domain specificity (generic adult batch 批判は FP)
 *   P7: Cross-screen aggregation の単独 finding 制限 (5 age tier 重複 → 1 件集約)
 *
 * 効果実証: arXiv 2502.15861 C3AI で 20-35% FP 削減実証、本 product DESIGN.md SSOT は world-class quality
 *
 * cost 試算 (Real mode): $2-12 ($0.1-0.3 per finding × K survivors 20-40 件)
 */

/**
 * Constitution P1-P7 (本 Round 起草、SSOT)
 */
export const CONSTITUTION_PRINCIPLES = [
	{
		id: 'P1',
		name: 'DESIGN.md §9 5 点禁忌の機械化済対象を AI 重複指摘禁止',
		fp_kill_pattern: 'automated check (stylelint / eslint / check-no-plan-literals) で捕捉可能',
	},
	{
		id: 'P2',
		name: 'ADR-0012 Anti-engagement 原則',
		fp_kill_pattern: 'engagement / 滞在時間 / surprise 推奨',
	},
	{
		id: 'P3',
		name: 'ADR-0045 terms.ts atom SSOT 経由用語',
		fp_kill_pattern: 'atom 値を「不適切」批判',
	},
	{
		id: 'P4',
		name: '5 age tier (baby/preschool/elementary/junior/senior) 整合性',
		fp_kill_pattern: 'age tier 横断的批判 (○○ 基準で △△ tier を批判)',
	},
	{
		id: 'P5',
		name: 'ADR-0010 Pre-PMF 過剰防衛回避',
		fp_kill_pattern: 'Pre-PMF resource 不適合 (大規模 testing / 国際化 / 高度 analytics)',
	},
	{
		id: 'P6',
		name: '子供向け UI 評価の domain specificity',
		fp_kill_pattern: 'generic adult batch 批判 (professional / 複雑機能 / engagement)',
	},
	{
		id: 'P7',
		name: 'Cross-screen aggregation の単独 finding 制限',
		fp_kill_pattern: 'cross-screen 重複報告 (5 age tier で 5 回独立)',
	},
];

/**
 * Mock critique 生成 (各 finding に P1-P7 適用)
 *
 * Mock 戦略: index ベースで principle 違反を simulate
 *   - index % 7 == 0 → P1 violates (engagement / hex / 用語の機械化済 finding が紛れ込む想定)
 *   - index % 7 == 1 → P2 violates (engagement 推奨)
 *   - index % 5 == 0 → P5 violates (Pre-PMF 過剰要求) → severity 降格 (kill ではなく)
 *   - その他 → uphold
 */
function buildMockCritique(candidate, index) {
	const violations = [];
	let revisedSeverity = candidate.severity ?? candidate.avg_severity ?? 0;

	if (index % 7 === 0) {
		violations.push({
			principle_id: 'P1',
			violates: true,
			explanation: `[P1 violation 100+ 文字] 本 finding は DESIGN.md §9 5 禁忌のうち「hex 直書き routes/features」に該当する可能性が高く、stylelint color-no-hex で既機械化済 (CI 自動拒否)。AI 重複指摘で過剰検出、kill 推奨`,
		});
	}
	if (index % 7 === 1) {
		violations.push({
			principle_id: 'P2',
			violates: true,
			explanation: `[P2 violation 100+ 文字] 本 finding は ADR-0012 Anti-engagement 原則違反 (子供 UI engagement 推奨 / 滞在時間延伸推奨)。本 product 設計原則「記録する → 数秒で閉じる最短経路」と矛盾、業界一般 UX heuristic の domain mismatch FP`,
		});
	}
	if (index % 5 === 0 && violations.length === 0) {
		// P5: kill ではなく severity 降格 (Pre-PMF 過剰要求は Ready 化 block しないが severity 0-1 に降格)
		revisedSeverity = Math.min(revisedSeverity, 1);
	}

	const overallVerdict = violations.length > 0 ? 'kill' : 'uphold';
	return {
		candidate_id: candidate.id,
		principle_violations: violations,
		revised_severity: revisedSeverity,
		confidence: 0.75,
		overall_verdict: overallVerdict,
	};
}

/**
 * Layer D run (Real / Mock 両対応)
 */
export async function runLayerD({
	layerCOutput,
	mock = false,
	// Phase 1.2 Real mode 実装互換性維持のため interface 保持 (#2711)
	anthropicApiKey: _anthropicApiKey,
	model: _model = 'claude-opus-4-7',
}) {
	const candidates = layerCOutput.aggregated || [];

	if (mock) {
		console.log(`[layer-d] MOCK mode: ${candidates.length} candidates に P1-P7 critique`);
		const critiques = candidates.map((c, i) => buildMockCritique(c, i));
		const killed = critiques.filter((cr) => cr.overall_verdict === 'kill');
		const upheld = critiques.filter((cr) => cr.overall_verdict === 'uphold');
		const survivors = upheld
			.map((cr) => {
				const orig = candidates.find((c) => c.id === cr.candidate_id);
				return orig ? { ...orig, severity: cr.revised_severity, constitution_passed: true } : null;
			})
			.filter(Boolean);

		console.log(`[layer-d] killed=${killed.length} upheld=${upheld.length}`);

		return {
			layer: 'D',
			principles: CONSTITUTION_PRINCIPLES.map((p) => p.id),
			findings_in: candidates.length,
			findings_out: survivors.length,
			kill_rate: candidates.length > 0 ? killed.length / candidates.length : 0,
			aggregated: survivors,
			critiques,
		};
	}

	throw new Error(`[layer-d] Real mode は Phase 1.2 で実装予定`);
}
