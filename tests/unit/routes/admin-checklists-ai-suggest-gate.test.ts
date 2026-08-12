// tests/unit/routes/admin-checklists-ai-suggest-gate.test.ts
// #4506 (EPIC #4495 / GAMMA2-ADM1-01): /admin/checklists の AI 提案パネル UI プランゲート。
//
// ## 経緯 (Issue 本文の前提は実測で否定された)
//
// #4506 は「`+page.server.ts` が planTier を返さないので `data.planTier === 'family'` は常に
// false、プレミアム加入者もロックされる (money/high)」と報告していた。**再現しない。**
// `data` は祖先 layout の戻り値をマージしたものであり、`(parent)/admin/+layout.server.ts` が
// planTier を返しているため解決していた (premium account の実機で非ロックを実測)。
//
// 本 PR の変更は **判定値を変えない SSOT 統一 + 参照元の明示** である。page load でも planTier を
// 返すのは、この page だけを読んで「常に undefined」と誤読する事故 (#2902 / #4506 の 2 回) を
// 止めるため。
//
// ## 本 test が固定する契約
//
// 1. load が `planTier` を **返す** こと (undefined でないこと)。これが silent false の根本原因で、
//    「参照先が無い式が静かに false になる」ことを検出できる唯一の層である。
// 2. free / standard / premium(family) の 3 tier について、load 出力から導出した表示状態が
//    server gate (premium のみ許可) と一致すること。
//
// 導出は `isAiSuggestUnlocked()` (SSOT) 経由で行う。**型では守れない**ことに注意 — 生成される
// `PageData` は `Record<string, any>` を含むため、load が planTier を返さなくなっても
// svelte-check / tsc は error を出さない (実測済)。よって silent false の排除は
// 本 file (load 出力の実行時 assert) と
// `tests/unit/architecture/ai-suggest-gate-derivation.test.ts` (page ↔ load 対応の静的検査) の
// 2 層で行う。表示状態そのものの検証は
// `tests/unit/components/ai-suggest-gate-display-matrix.test.ts` が担う。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAiSuggestUnlocked } from '$lib/domain/ai-suggest-gate';
import type { PlanTier } from '$lib/domain/constants/plan-tier';

const mockResolveFullPlanTier = vi.fn();

vi.mock('$lib/server/db/checklist-repo', () => ({
	findAssignmentsByChild: vi.fn().mockResolvedValue([]),
	findAssignmentsByTemplate: vi.fn().mockResolvedValue([]),
	findOverrides: vi.fn().mockResolvedValue([]),
	findTemplateItems: vi.fn().mockResolvedValue([]),
	findTemplatesByTenant: vi.fn().mockResolvedValue([]),
	findTodayLog: vi.fn().mockResolvedValue(null),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn().mockResolvedValue([]),
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	isPaidTier: (tier: string) => tier === 'standard' || tier === 'family',
	getPlanLimits: (tier: string) => ({ maxChecklistTemplates: tier === 'free' ? 3 : null }),
	checkChecklistTemplateLimit: vi.fn(),
}));

vi.mock('$lib/server/services/checklist-service', () => ({
	addOverride: vi.fn(),
	addTemplateItem: vi.fn(),
	createTemplate: vi.fn(),
	editTemplate: vi.fn(),
	removeOverride: vi.fn(),
	removeTemplate: vi.fn(),
	removeTemplateItem: vi.fn(),
	VALID_TIME_SLOTS: ['morning', 'afternoon', 'evening', 'anytime'],
}));

vi.mock('$lib/server/services/checklist-distribution-service', () => ({
	distributeToChildren: vi.fn(),
	syncDistribution: vi.fn(),
}));

vi.mock('$lib/server/services/checklist-template-import-service', () => ({
	importChecklistTemplateFromPayload: vi.fn(),
	previewChecklistImportFromPayload: vi.fn(),
}));

vi.mock('$lib/marketplace', () => ({ dispatchImport: vi.fn() }));

vi.mock('$lib/marketplace/sources/file-source', () => ({
	FileSourceError: class FileSourceError extends Error {},
	loadChecklistFromFile: vi.fn(),
}));

vi.mock('$lib/data/marketplace', () => ({ getMarketplaceItem: vi.fn().mockReturnValue(null) }));

vi.mock('$lib/server/auth/audit-actor', () => ({ resolveAuditActor: vi.fn() }));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { load } = await import('../../../src/routes/(parent)/admin/checklists/+page.server');

function createEvent() {
	return {
		locals: { context: { tenantId: 't-test', licenseStatus: 'active', plan: null } },
		url: new URL('http://localhost/admin/checklists'),
		// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の event は本 test で使う 2 件のみ供給する
	} as any;
}

/**
 * load を走らせて出力を得る。
 *
 * `PageServerLoad` の戻り型は `void` を含む union (redirect 等を許す SvelteKit の型) なので、
 * 呼び出し側で narrowing する。**planTier の有無そのものは実行時に assert する** (本 test の主題が
 * 「返っていないこと」の検出なので、型で消してはいけない)。
 */
async function loadWithTier(
	tier: PlanTier,
): Promise<Record<string, unknown> & { planTier?: PlanTier; isPremium?: boolean }> {
	mockResolveFullPlanTier.mockResolvedValue(tier);
	const result = await load(createEvent());
	if (!result) throw new Error('load が data を返しませんでした');
	return result;
}

/** 実行時に planTier の存在を確かめてから述語に渡す (undefined を静かに渡さない)。 */
function unlockedFrom(data: { planTier?: PlanTier }): boolean {
	expect(data.planTier, 'load が planTier を返していません').toBeDefined();
	return isAiSuggestUnlocked(data.planTier as PlanTier);
}

describe('/admin/checklists load — AI 提案パネルのプランゲート導出値 (#4506)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ============================================================
	// 根本原因: load が planTier を返さず `undefined === 'family'` が静かに false になっていた
	// ============================================================

	describe('回帰: load が planTier を返す (silent false の排除)', () => {
		it.each<PlanTier>([
			'free',
			'standard',
			'family',
		])('%s tier で planTier が undefined でない', async (tier) => {
			const data = await loadWithTier(tier);
			// これが undefined だと UI 側の gate 式が全 tier で false に潰れる (#4506 の実害)
			expect(data.planTier).toBeDefined();
			expect(data.planTier).toBe(tier);
		});

		it('従来の isPremium も引き続き返す (既存 UI の後方互換)', async () => {
			expect((await loadWithTier('standard')).isPremium).toBe(true);
			expect((await loadWithTier('free')).isPremium).toBe(false);
		});
	});

	// ============================================================
	// 表示状態マトリクス (load 出力 → gate 導出)
	// ============================================================

	describe('プラン別の AI 提案ロック状態', () => {
		it('free: ロックされる', async () => {
			expect(unlockedFrom(await loadWithTier('free'))).toBe(false);
		});

		it('standard: ロックされる (server gate = premium 限定 と一致)', async () => {
			expect(unlockedFrom(await loadWithTier('standard'))).toBe(false);
		});

		it('premium(family): ロックされない — 購入済み機能が使える (#4506 本丸)', async () => {
			expect(unlockedFrom(await loadWithTier('family'))).toBe(true);
		});
	});
});
