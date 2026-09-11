// tests/unit/routes/subscription-cancel-downgrade-gate.test.ts
// #4585-1 — 解約画面が「選択 UI を挟むか」「fallback で何が残るか」を判断できる材料を load が返す。
//
// 画面側 (+page.svelte) は planTier で選択 UI を挟むかを決め、freeLimits で
// 「選ばずに進めた場合」の残る数を述べる。どちらも画面に数値を書き写さず、
// 実効プラン (resolveFullPlanTier) と plan-limit-service を SSOT にする。

// biome-ignore-all lint/suspicious/noExplicitAny: テスト用 load の型を最小化

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlanLimits } from '../../../src/lib/server/services/plan-limit-service';

const mockGetLicenseInfo = vi.fn();
const mockResolveFullPlanTier = vi.fn();

vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
}));

vi.mock('$lib/server/services/plan-limit-service', async (importOriginal) => {
	// 上限値は実物 (SSOT) を使い、DB を引く実効プラン解決だけ差し替える
	const actual = await importOriginal<typeof import('$lib/server/services/plan-limit-service')>();
	return {
		...actual,
		resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	};
});

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

import { load as loadRaw } from '../../../src/routes/(parent)/admin/subscription/cancel/+page.server';

const load = loadRaw as unknown as (...args: unknown[]) => any;

beforeEach(() => {
	vi.clearAllMocks();
	mockGetLicenseInfo.mockResolvedValue({
		plan: 'standard',
		stripeSubscriptionId: 'sub_1',
		stripeCustomerId: 'cus_1',
	});
	mockResolveFullPlanTier.mockResolvedValue('standard');
});

describe('#4585-1 解約画面の load', () => {
	it('実効プラン (planTier) を返す — license.plan ではなくトライアル込みの実効値で判定する', async () => {
		const data = await load({
			locals: { context: { tenantId: 'tenant-1', licenseStatus: 'active', plan: 'standard' } },
		});

		expect(data.planTier).toBe('standard');
		expect(mockResolveFullPlanTier).toHaveBeenCalledWith('tenant-1', 'active', 'standard');
	});

	it('fallback の説明に使う無料プランの上限を plan-limit-service から返す (画面に数値を書き写さない)', async () => {
		const data = await load({ locals: { context: { tenantId: 'tenant-1' } } });
		const freeLimits = getPlanLimits('free');

		expect(data.freeLimits).toEqual({
			maxChildren: freeLimits.maxChildren,
			maxActivities: freeLimits.maxActivities,
			maxChecklistTemplates: freeLimits.maxChecklistTemplates,
		});
	});

	it('無料プランの顧客は planTier=free になる (選択 UI を挟まない側に倒れる)', async () => {
		mockGetLicenseInfo.mockResolvedValue(null);
		mockResolveFullPlanTier.mockResolvedValue('free');

		const data = await load({ locals: { context: { tenantId: 'tenant-1' } } });

		expect(data.planTier).toBe('free');
		expect(data.isPaidPlan).toBe(false);
	});
});
