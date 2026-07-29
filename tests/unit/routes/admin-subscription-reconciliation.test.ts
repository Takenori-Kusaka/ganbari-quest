// tests/unit/routes/admin-subscription-reconciliation.test.ts
// #3958: /admin/subscription の load が success_url の session_id を読むことの契約テスト
//
// 背景: success_url には `?session_id=cs_…` が付いて戻ってくるが、この load は `url` すら
// 受け取っておらず、値を読む実装が src 全体で 0 件だった。webhook が 1 通落ちるだけで
// 顧客は永久に無料プランのままになる (2026-07-26 本番 incident)。
//
// テスト観点:
// - session_id なし → Stripe に照会せず、既存表示のまま (通常アクセスに副作用を出さない)
// - session_id あり → 反映してから license / planTier を読む (画面が反映後の状態になる)
// - 反映失敗 (不正 / 期限切れ) → 例外にせず既存表示にフォールバックする

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReconcile = vi.fn();
const mockGetLicenseInfo = vi.fn();
const mockResolveTenantEntitlement = vi.fn();
const mockResolveFullPlanTier = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

vi.mock('$lib/server/services/stripe-service', () => ({
	reconcileCheckoutSession: (...args: unknown[]) => mockReconcile(...args),
}));

vi.mock('$lib/server/auth/tenant-entitlement', () => ({
	resolveTenantEntitlement: (...args: unknown[]) => mockResolveTenantEntitlement(...args),
}));

vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
}));

vi.mock('$lib/server/services/loyalty-service', () => ({
	getLoyaltyInfo: vi.fn().mockResolvedValue(null),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn().mockResolvedValue([]),
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn().mockResolvedValue({
		isTrialActive: false,
		trialUsed: false,
		daysRemaining: 0,
		trialEndDate: null,
		trialTier: null,
	}),
	startTrial: vi.fn(),
}));

vi.mock('$lib/server/services/auth-service', () => ({
	isPinConfigured: vi.fn().mockResolvedValue(true),
}));

vi.mock('$lib/server/services/activity-service', () => ({
	getActivities: vi.fn().mockResolvedValue([]),
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	getPlanLimits: () => ({ maxActivities: 10, maxChildren: 1, historyRetentionDays: 90 }),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
}));

const { load } = await import('../../../src/routes/(parent)/admin/subscription/+page.server');

const LOCALS = {
	context: { tenantId: 't-test', licenseStatus: 'none', plan: undefined },
};

function makeEvent(search = '') {
	return {
		locals: LOCALS,
		url: new URL(`https://app.example/admin/subscription${search}`),
	} as never;
}

/** `PageServerLoad` の戻り型は `void` を含むため、テスト側で存在を確定させる */
async function runLoad(search = '') {
	const data = await load(makeEvent(search));
	if (!data) throw new Error('load returned no data');
	return data;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetLicenseInfo.mockResolvedValue({
		plan: 'free',
		status: 'active',
		tenantName: 'テスト家族',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
	});
	mockResolveFullPlanTier.mockResolvedValue('free');
	mockReconcile.mockResolvedValue({ status: 'applied' });
	mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'active', plan: 'monthly' });
});

describe('/admin/subscription load — checkout reconciliation (#3958)', () => {
	it('session_id が無い通常アクセスでは Stripe に照会しない', async () => {
		const data = await runLoad();

		expect(mockReconcile).not.toHaveBeenCalled();
		expect(data.checkoutReconciliation).toBeNull();
	});

	it('session_id 付きで戻ると照合を実行し、結果を画面に渡す', async () => {
		const data = await runLoad('?session_id=cs_test_a1b2c3d4e5f6');

		expect(mockReconcile).toHaveBeenCalledWith({
			tenantId: 't-test',
			sessionId: 'cs_test_a1b2c3d4e5f6',
		});
		expect(data.checkoutReconciliation).toEqual({ status: 'applied' });
	});

	it('反映後は locals.context (古い課金状態) ではなく DB の最新 entitlement で planTier を出す', async () => {
		await runLoad('?session_id=cs_test_a1b2c3d4e5f6');

		// locals.context は hooks が load 前に解決した値なので licenseStatus=none のまま。
		// これを使うと「反映したのに無料プラン表示」になる (本 Issue の症状そのもの)。
		expect(mockResolveTenantEntitlement).toHaveBeenCalledWith('t-test');
		expect(mockResolveFullPlanTier).toHaveBeenCalledWith('t-test', 'active', 'monthly');
	});

	it('照合が未反映で終わった場合は DB 再解決せず既存表示にフォールバックする', async () => {
		mockReconcile.mockResolvedValue({ status: 'not_found' });

		const data = await runLoad('?session_id=cs_bogus_value');

		expect(mockResolveTenantEntitlement).not.toHaveBeenCalled();
		expect(mockResolveFullPlanTier).toHaveBeenCalledWith('t-test', 'none', undefined);
		expect(data.license.plan).toBe('free');
		expect(data.checkoutReconciliation).toEqual({ status: 'not_found' });
	});
});
