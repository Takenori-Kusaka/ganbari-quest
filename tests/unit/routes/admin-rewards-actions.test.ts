// tests/unit/routes/admin-rewards-actions.test.ts
// #728: /admin/rewards のプランゲート — grant / addPreset 403 + load の isPremium
// PR #2474 (#2362 PR-4, ADR-0055 + CWE-598): importPresetToChildren / copyFromChild の
// tenant 配下 child guard (CWE-598 IDOR 防御) を追加検証 (must-1)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---
const mockRequireTenantId = vi.fn();
const mockResolveFullPlanTier = vi.fn();
const mockGetAllChildren = vi.fn();
const mockGetRewardTemplates = vi.fn();
const mockGetChildSpecialRewards = vi.fn();
const mockGrantSpecialReward = vi.fn();
const mockSaveRewardTemplates = vi.fn();
const mockDispatchImport = vi.fn();
const mockCopyChildRewardsToSibling = vi.fn();
const mockCopyChildRewardsToSiblings = vi.fn();
const mockGetMarketplaceItem = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: mockRequireTenantId,
	getAuthMode: vi.fn(() => 'cognito'),
}));

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: mockResolveFullPlanTier,
	};
});

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: mockGetAllChildren,
}));

vi.mock('$lib/server/services/special-reward-service', () => ({
	getChildSpecialRewards: mockGetChildSpecialRewards,
	getRewardTemplates: mockGetRewardTemplates,
	addReward: mockGrantSpecialReward,
	grantSpecialReward: mockGrantSpecialReward,
	saveRewardTemplates: mockSaveRewardTemplates,
}));

vi.mock('$lib/marketplace', () => ({
	dispatchImport: mockDispatchImport,
}));

vi.mock('$lib/data/marketplace', () => ({
	getMarketplaceIndex: vi.fn(() => []),
	getMarketplaceItem: mockGetMarketplaceItem,
}));

vi.mock('$lib/server/services/child-reward-copy-service', () => ({
	copyChildRewardsToSibling: mockCopyChildRewardsToSibling,
	copyChildRewardsToSiblings: mockCopyChildRewardsToSiblings,
}));

vi.mock('$lib/server/services/reward-redemption-service', () => ({
	getRedemptionRequestsForParent: vi.fn(async () => []),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mod = await import('../../../src/routes/(parent)/admin/rewards/+page.server');
// SvelteKit の Actions 型は optional を含むため、テスト用に non-null 化
const load = mod.load as unknown as (event: {
	locals: App.Locals;
	url: URL;
}) => Promise<{ isPremium: boolean; planTier: string; children: unknown[]; templates: unknown[] }>;
type PlanLimitErrorShape = {
	code: 'PLAN_LIMIT_EXCEEDED';
	message: string;
	currentTier: 'free' | 'standard' | 'family';
	requiredTier: 'standard' | 'family';
	upgradeUrl: '/admin/subscription';
};
// #2268: grant → add リネーム
const grantAction = mod.actions.add as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<{
	status?: number;
	data?: { error: PlanLimitErrorShape | string };
	granted?: boolean;
}>;
const addPresetAction = mod.actions.addPreset as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<{
	status?: number;
	data?: { error: PlanLimitErrorShape | string };
	presetAdded?: boolean;
}>;

// PR #2474 must-1: importPresetToChildren / copyFromChild の CWE-598 guard 検証用
type ActionResult = {
	status?: number;
	data?: { error?: PlanLimitErrorShape | string; [k: string]: unknown };
	[k: string]: unknown;
};
const importPresetToChildrenAction = mod.actions.importPresetToChildren as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<ActionResult>;
const copyFromChildAction = mod.actions.copyFromChild as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<ActionResult>;

function makeLocals(opts: { licenseStatus?: string; plan?: string; tenantId?: string } = {}) {
	return {
		context: {
			tenantId: opts.tenantId ?? 'tenant-1',
			licenseStatus: opts.licenseStatus ?? 'none',
			plan: opts.plan,
		},
	} as unknown as App.Locals;
}

function makeFormRequest(fields: Record<string, string | number>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		form.append(k, String(v));
	}
	return new Request('http://localhost/admin/rewards', { method: 'POST', body: form });
}

describe('/admin/rewards page.server', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		mockGetAllChildren.mockResolvedValue([]);
		mockGetRewardTemplates.mockResolvedValue([]);
		mockGetChildSpecialRewards.mockResolvedValue({ rewards: [], totalPoints: 0 });
	});

	describe('load', () => {
		it('無料プランでは isPremium: false を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			const result = await load({
				locals: makeLocals({ licenseStatus: 'none' }),
				url: new URL('http://localhost/admin/rewards'),
			});
			expect(result.isPremium).toBe(false);
			expect(result.planTier).toBe('free');
		});

		it('スタンダードプランでは isPremium: true を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			const result = await load({
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
				url: new URL('http://localhost/admin/rewards'),
			});
			expect(result.isPremium).toBe(true);
			expect(result.planTier).toBe('standard');
		});

		it('ファミリープランでは isPremium: true を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('family');
			const result = await load({
				locals: makeLocals({ licenseStatus: 'active', plan: 'family_monthly' }),
				url: new URL('http://localhost/admin/rewards'),
			});
			expect(result.isPremium).toBe(true);
			expect(result.planTier).toBe('family');
		});
	});

	describe('grant action', () => {
		it('無料プランでは 403 を返し grantSpecialReward を呼ばない（PlanLimitError 形式 #787）', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			const result = await grantAction({
				request: makeFormRequest({ childId: 1, title: 'ごほうび', points: 100, icon: '🎁' }),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBe(403);
			const err = result.data?.error as PlanLimitErrorShape;
			expect(err).toMatchObject({
				code: 'PLAN_LIMIT_EXCEEDED',
				currentTier: 'free',
				requiredTier: 'standard',
				upgradeUrl: '/admin/subscription',
			});
			expect(mockGrantSpecialReward).not.toHaveBeenCalled();
		});

		it('スタンダードプランでは grantSpecialReward を実行', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockGrantSpecialReward.mockResolvedValue({ id: 1, title: 'ごほうび', points: 100 });

			const result = await grantAction({
				request: makeFormRequest({ childId: 1, title: 'ごほうび', points: 100, icon: '🎁' }),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(mockGrantSpecialReward).toHaveBeenCalledTimes(1);
			expect(result.granted).toBe(true);
		});

		it('ファミリープランでも grantSpecialReward を実行', async () => {
			mockResolveFullPlanTier.mockResolvedValue('family');
			mockGrantSpecialReward.mockResolvedValue({ id: 2, title: 'おてつだい', points: 50 });

			const result = await grantAction({
				request: makeFormRequest({ childId: 1, title: 'おてつだい', points: 50, icon: '🧹' }),
				locals: makeLocals({ licenseStatus: 'active', plan: 'family_monthly' }),
			});

			expect(mockGrantSpecialReward).toHaveBeenCalledTimes(1);
			expect(result.granted).toBe(true);
		});

		// #3147: shop_category 列をフォームから addReward へ受け渡す
		it('親が選んだ shopCategory (privilege) を addReward に渡す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockGrantSpecialReward.mockResolvedValue({ id: 3, title: 'ゲーム30分', points: 100 });

			await grantAction({
				request: makeFormRequest({
					childId: 1,
					title: 'ゲーム30分',
					points: 100,
					icon: '🎮',
					shopCategory: 'privilege',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(mockGrantSpecialReward).toHaveBeenCalledTimes(1);
			const arg = mockGrantSpecialReward.mock.calls[0]?.[0];
			expect(arg.shopCategory).toBe('privilege');
		});

		it('shopCategory 未選択 (空) は null として addReward に渡す (表示側 fallback)', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockGrantSpecialReward.mockResolvedValue({ id: 4, title: 'おやつ', points: 30 });

			await grantAction({
				request: makeFormRequest({ childId: 1, title: 'おやつ', points: 30, icon: '🍪' }),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			const arg = mockGrantSpecialReward.mock.calls[0]?.[0];
			expect(arg.shopCategory).toBeNull();
		});

		it('shopCategory に不正値が来た場合は null に正規化する', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockGrantSpecialReward.mockResolvedValue({ id: 5, title: 'ふせい', points: 10 });

			await grantAction({
				request: makeFormRequest({
					childId: 1,
					title: 'ふせい',
					points: 10,
					icon: '🎁',
					shopCategory: 'not-a-real-category',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			const arg = mockGrantSpecialReward.mock.calls[0]?.[0];
			expect(arg.shopCategory).toBeNull();
		});
	});

	describe('addPreset action', () => {
		it('無料プランでは 403 を返し saveRewardTemplates を呼ばない（PlanLimitError 形式 #787）', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');

			const result = await addPresetAction({
				request: makeFormRequest({
					title: 'プリセット',
					points: 100,
					icon: '🎁',
					category: 'とくべつ',
				}),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBe(403);
			const err = result.data?.error as PlanLimitErrorShape;
			expect(err).toMatchObject({
				code: 'PLAN_LIMIT_EXCEEDED',
				currentTier: 'free',
				requiredTier: 'standard',
			});
			expect(mockSaveRewardTemplates).not.toHaveBeenCalled();
		});

		it('スタンダードプランでは saveRewardTemplates を実行', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockGetRewardTemplates.mockResolvedValue([]);

			const result = await addPresetAction({
				request: makeFormRequest({
					title: 'プリセット',
					points: 100,
					icon: '🎁',
					category: 'とくべつ',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(mockSaveRewardTemplates).toHaveBeenCalledTimes(1);
			expect(result.presetAdded).toBe(true);
		});
	});

	// PR #2474 (#2362 PR-4, ADR-0055 + CWE-598) — must-1 IDOR guard
	describe('importPresetToChildren action — CWE-598 tenant child guard (PR #2474 must-1)', () => {
		beforeEach(() => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockGetMarketplaceItem.mockReturnValue({
				name: 'テスト報酬セット',
				payload: { rewards: [{ title: 'r1', points: 10, icon: '🎁' }] },
			});
			mockDispatchImport.mockResolvedValue({
				packName: 'テスト報酬セット',
				imported: 1,
				skipped: 0,
				total: 1,
				errors: [],
			});
		});

		it('childIds が tenant 配下 child の場合は dispatchImport を実行', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 100, nickname: 'a', age: 5 },
				{ id: 200, nickname: 'b', age: 7 },
			]);

			const result = await importPresetToChildrenAction({
				request: makeFormRequest({
					presetId: 'kinder-rewards',
					childIds: '100,200',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(mockDispatchImport).toHaveBeenCalledTimes(1);
			expect(result.status).toBeUndefined();
			expect(result.perChildImport).toBe(true);
		});

		it('childIds=all は tenant 配下 child 全件を fan-out target にする', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 100, nickname: 'a', age: 5 },
				{ id: 200, nickname: 'b', age: 7 },
			]);

			await importPresetToChildrenAction({
				request: makeFormRequest({
					presetId: 'kinder-rewards',
					childIds: 'all',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(mockDispatchImport).toHaveBeenCalledTimes(1);
			const callArg = mockDispatchImport.mock.calls[0]?.[0];
			expect(callArg.ctx.childIds).toEqual([100, 200]);
		});

		it('childIds に tenant 外 ID が混入すると 403 + dispatchImport を呼ばない (IDOR 防御)', async () => {
			// tenant 配下 = 100, 200 のみ
			mockGetAllChildren.mockResolvedValue([
				{ id: 100, nickname: 'a', age: 5 },
				{ id: 200, nickname: 'b', age: 7 },
			]);

			// 攻撃 input: 自分の child (100) に他 tenant の child (999) を混ぜる
			const result = await importPresetToChildrenAction({
				request: makeFormRequest({
					presetId: 'kinder-rewards',
					childIds: '100,999',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBe(403);
			expect(mockDispatchImport).not.toHaveBeenCalled();
		});

		it('childIds=99999 のみ (tenant 外) でも 403 reject', async () => {
			mockGetAllChildren.mockResolvedValue([{ id: 100, nickname: 'a', age: 5 }]);

			const result = await importPresetToChildrenAction({
				request: makeFormRequest({
					presetId: 'kinder-rewards',
					childIds: '99999',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBe(403);
			expect(mockDispatchImport).not.toHaveBeenCalled();
		});

		it('無料プランは 403 (CWE-598 guard より前にプランゲートで reject)', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');

			const result = await importPresetToChildrenAction({
				request: makeFormRequest({
					presetId: 'kinder-rewards',
					childIds: '100',
				}),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBe(403);
			expect(mockDispatchImport).not.toHaveBeenCalled();
		});
	});

	describe('copyFromChild action — CWE-598 tenant child guard (PR #2474 must-1)', () => {
		beforeEach(() => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockCopyChildRewardsToSibling.mockResolvedValue(3);
			mockCopyChildRewardsToSiblings.mockResolvedValue({ totalCopied: 3, errors: [] });
		});

		it('source / target が tenant 配下 child の場合は copy を実行', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 100, nickname: 'a', age: 5 },
				{ id: 200, nickname: 'b', age: 7 },
			]);

			const result = await copyFromChildAction({
				request: makeFormRequest({
					sourceChildId: '100',
					targetChildId: '200',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(mockCopyChildRewardsToSibling).toHaveBeenCalledTimes(1);
			expect(result.copyResult).toBe(true);
		});

		it('source が tenant 外なら 403 + copy を呼ばない (IDOR 防御)', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 100, nickname: 'a', age: 5 },
				{ id: 200, nickname: 'b', age: 7 },
			]);

			const result = await copyFromChildAction({
				request: makeFormRequest({
					sourceChildId: '999',
					targetChildId: '200',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBe(403);
			expect(mockCopyChildRewardsToSibling).not.toHaveBeenCalled();
		});

		it('target が tenant 外なら 403 + copy を呼ばない (IDOR 防御)', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 100, nickname: 'a', age: 5 },
				{ id: 200, nickname: 'b', age: 7 },
			]);

			const result = await copyFromChildAction({
				request: makeFormRequest({
					sourceChildId: '100',
					targetChildId: '999',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBe(403);
			expect(mockCopyChildRewardsToSibling).not.toHaveBeenCalled();
		});

		it('targetChildIds (CSV) のうち 1 件でも tenant 外なら 403 + copy を呼ばない', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 100, nickname: 'a', age: 5 },
				{ id: 200, nickname: 'b', age: 7 },
				{ id: 300, nickname: 'c', age: 9 },
			]);

			// 200 (valid) + 999 (foreign) の混在
			const result = await copyFromChildAction({
				request: makeFormRequest({
					sourceChildId: '100',
					targetChildIds: '200,999',
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBe(403);
			expect(mockCopyChildRewardsToSibling).not.toHaveBeenCalled();
			expect(mockCopyChildRewardsToSiblings).not.toHaveBeenCalled();
		});
	});
});
