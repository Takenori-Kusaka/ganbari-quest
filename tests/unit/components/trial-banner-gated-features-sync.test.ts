// tests/unit/components/trial-banner-gated-features-sync.test.ts
//
// #2919 項目1: TrialBanner の `bannerGatedFeatures`（「無料版では制限される機能」列挙）と
// 実際の plan gate 定義（PLAN_LIMITS / suggest-plan-gate）の同期 unit test。
//
// 【設計意図 — どの drift を、どう検出するか】
//   `TRIAL_LABELS.bannerGatedFeatures` は free ユーザーに「これは無料版では制限される」と
//   訴求する手書きの readonly 配列（labels.ts）。一方、実際にその機能を制限している enforcement は
//   plan-limit-service.ts の `PLAN_LIMITS` と suggest-plan-gate.ts の family-only gate にある。
//   この 2 つは別ファイルで独立して進化するため、次の 2 方向の drift が起こりうる:
//
//   (A) 「表示しているのに enforcement が無い」嘘訴求
//       例: 将来 free で活動作成が無制限化された（maxActivities=null 化）のに、
//           banner には「活動の作成を無制限に」が残り続ける → free ユーザーに「制限される」と
//           誤情報を提示（NN/G #1 visibility 違反 + ADR-0013 truth 違反）。
//   (B) 「banner 文言の対象機能が SSOT から消えた / 改名された」リンク切れ
//       例: FEATURE_LABELS.dataExport / aiActivitySuggest を rename したのに banner 側参照が
//           古いまま → 文言と enforcement の対応が崩れる。
//
//   本 test は banner の 5 項目それぞれを「対応する実 gate が free で制限・paid で解放されている」
//   ことに 1:1 で結びつけて assert する。gate 側で制限が外れた / 文言の対象 atom が消えた瞬間に
//   この test が fail し、表示（banner）と enforcement（gate）の乖離を CI で検出する。
//
//   なお banner は「FEATURE_LABELS / CHILD_TERMS の atom を template literal で組み立てた compound」
//   （ADR-0045）であり、ここでは「banner 文言が対応 atom を含む」ことを通じて参照リンクの健全性も検証する。
//
//   suggest-plan-gate の family-only 判定は `resolveFullPlanTier`（内部で trial DB / request-context を叩く）
//   に依存するため、既存 activities-suggest-api.test.ts と同様に同関数のみ mock し、gate の分岐ロジック
//   （tier !== 'family' を弾く）を純粋に検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveFullPlanTier = vi.fn();

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: mockResolveFullPlanTier,
	};
});

const { FEATURE_LABELS, TRIAL_LABELS } = await import('../../../src/lib/domain/labels');
const { CHILD_TERMS } = await import('../../../src/lib/domain/terms');
const { validateSuggestRequest } = await import('../../../src/lib/server/api/suggest-plan-gate');
const { getPlanLimits } = await import('../../../src/lib/server/services/plan-limit-service');
type PlanTier = import('../../../src/lib/server/services/plan-limit-service').PlanTier;

const freeLimits = getPlanLimits('free');
const standardLimits = getPlanLimits('standard');
const familyLimits = getPlanLimits('family');

/**
 * suggest-plan-gate.ts の family-only 判定を tier 別に検証するヘルパ。
 * resolveFullPlanTier を mock して、gate が tier !== 'family' を弾くことのみを純粋検証する。
 */
async function expectSuggestGate(tier: PlanTier, shouldPass: boolean): Promise<void> {
	mockResolveFullPlanTier.mockResolvedValue(tier);

	const locals = {
		context: {
			tenantId: `t-${tier}`,
			licenseStatus: tier === 'free' ? 'none' : 'active',
			plan: tier === 'free' ? undefined : `${tier}_monthly`,
		},
	} as unknown as App.Locals;

	const request = new Request('http://localhost/api/x', {
		method: 'POST',
		body: JSON.stringify({ text: 'テスト入力' }),
	});

	const result = await validateSuggestRequest(locals, request, FEATURE_LABELS.aiActivitySuggest);

	if (shouldPass) {
		expect(result.ok).toBe(true); // family は gate を通過
	} else {
		expect(result.ok).toBe(false); // free / standard は PLAN_LIMIT_EXCEEDED で弾かれる
	}
}

/**
 * banner の各文言を「その文言が訴求する制限」を実証する gate 検証へ写像する。
 *
 * - `bannerText`: TRIAL_LABELS.bannerGatedFeatures に実在する文言（リンク切れなら集合一致 test が fail）
 * - `assertGate`: free で制限 / paid（standard or family）で解放 されていることを検証する
 */
const FEATURE_GATE_MAP: ReadonlyArray<{
	name: string;
	bannerText: string;
	assertGate: () => void | Promise<void>;
}> = [
	{
		name: '活動の作成を無制限に（maxActivities gate）',
		bannerText: `${FEATURE_LABELS.activity}の作成を無制限に`,
		assertGate: () => {
			// free は有限上限、standard/family は無制限(null)。drift（free が null 化）で fail。
			expect(freeLimits.maxActivities).not.toBeNull();
			expect(typeof freeLimits.maxActivities).toBe('number');
			expect(standardLimits.maxActivities).toBeNull();
			expect(familyLimits.maxActivities).toBeNull();
		},
	},
	{
		name: 'お子さまの登録を無制限に（maxChildren gate）',
		bannerText: `${CHILD_TERMS.honorific}の登録を無制限に`,
		assertGate: () => {
			expect(freeLimits.maxChildren).not.toBeNull();
			expect(typeof freeLimits.maxChildren).toBe('number');
			expect(standardLimits.maxChildren).toBeNull();
			expect(familyLimits.maxChildren).toBeNull();
		},
	},
	{
		name: 'AI 提案（suggest-plan-gate family-only gate）',
		bannerText: FEATURE_LABELS.aiActivitySuggest,
		assertGate: async () => {
			// validateSuggestRequest は family 以外を PLAN_LIMIT_EXCEEDED で弾く。
			// free / standard が弾かれ family が通過することで「free 制限」を実証する。
			await expectSuggestGate('free', false);
			await expectSuggestGate('standard', false);
			await expectSuggestGate('family', true);
		},
	},
	{
		name: '特別なごほうび設定（canCustomReward gate）',
		bannerText: `特別な${FEATURE_LABELS.reward}設定`,
		assertGate: () => {
			expect(freeLimits.canCustomReward).toBe(false);
			// standard 以上で解放（#728）
			expect(standardLimits.canCustomReward).toBe(true);
			expect(familyLimits.canCustomReward).toBe(true);
		},
	},
	{
		name: 'データエクスポート（canExport gate）',
		bannerText: FEATURE_LABELS.dataExport,
		assertGate: () => {
			expect(freeLimits.canExport).toBe(false);
			expect(standardLimits.canExport).toBe(true);
			expect(familyLimits.canExport).toBe(true);
		},
	},
];

describe('#2919 TrialBanner bannerGatedFeatures ↔ plan gate 同期', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('banner の項目数が gate 写像表と一致する（項目の増減 drift を検出）', () => {
		// banner に項目が足された／消えたのに gate 写像が追従していない場合に fail。
		expect(TRIAL_LABELS.bannerGatedFeatures.length).toBe(FEATURE_GATE_MAP.length);
	});

	it('banner の全項目が gate 写像表で参照される文言と集合一致する（リンク切れ検出）', () => {
		const bannerSet = [...TRIAL_LABELS.bannerGatedFeatures].sort();
		const mappedSet = FEATURE_GATE_MAP.map((m) => m.bannerText).sort();
		// labels.ts 側で atom が rename され compound が変わったが gate 写像が古いままなら不一致で fail。
		expect(mappedSet).toEqual(bannerSet);
	});

	for (const { name, bannerText, assertGate } of FEATURE_GATE_MAP) {
		it(`「${name}」: banner 文言が存在し、対応する実 gate が free 制限・paid 解放である`, async () => {
			// (B) banner にこの文言が実在すること（参照リンク健全性）
			expect(TRIAL_LABELS.bannerGatedFeatures).toContain(bannerText);
			// (A) enforcement が free で制限・paid で解放されていること（表示と enforcement の同期）
			await assertGate();
		});
	}
});
