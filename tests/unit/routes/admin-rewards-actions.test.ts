// tests/unit/routes/admin-rewards-actions.test.ts
// #728: /admin/rewards のプランゲート — grant / addPreset 403 + load の isPremium

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---
const mockRequireTenantId = vi.fn();
const mockResolveFullPlanTier = vi.fn();
const mockGetAllChildren = vi.fn();
const mockGetRewardTemplates = vi.fn();
const mockGetChildSpecialRewards = vi.fn();
const mockGrantSpecialReward = vi.fn();
const mockSaveRewardTemplates = vi.fn();

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
	grantSpecialReward: mockGrantSpecialReward,
	saveRewardTemplates: mockSaveRewardTemplates,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mod = await import('../../../src/routes/(parent)/admin/rewards/+page.server');
// SvelteKit の Actions 型は optional を含むため、テスト用に non-null 化
const load = mod.load as unknown as (event: {
	locals: App.Locals;
}) => Promise<{ isPremium: boolean; planTier: string; children: unknown[]; templates: unknown[] }>;
type PlanLimitErrorShape = {
	code: 'PLAN_LIMIT_EXCEEDED';
	message: string;
	currentTier: 'free' | 'standard' | 'family';
	requiredTier: 'standard' | 'family';
	upgradeUrl: '/admin/license';
};
const grantAction = mod.actions.grant as unknown as (event: {
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
			const result = await load({ locals: makeLocals({ licenseStatus: 'none' }) });
			expect(result.isPremium).toBe(false);
			expect(result.planTier).toBe('free');
		});

		it('スタンダードプランでは isPremium: true を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			const result = await load({
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});
			expect(result.isPremium).toBe(true);
			expect(result.planTier).toBe('standard');
		});

		it('ファミリープランでは isPremium: true を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('family');
			const result = await load({
				locals: makeLocals({ licenseStatus: 'active', plan: 'family_monthly' }),
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
				upgradeUrl: '/admin/license',
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
});
