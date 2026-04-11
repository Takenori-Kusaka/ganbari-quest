// tests/unit/routes/admin-tenant-cancel.test.ts
// #784: admin/tenant/cancel と admin/tenant/reactivate の契約テスト
//
// ADR-0022: 解約時は Stripe Subscription を即時キャンセルしてから DB を
// grace_period に遷移させる。Stripe 呼び出しが失敗した場合は DB を更新
// しない（課金継続防止）。
//
// テスト観点:
// - cancel: Stripe cancel が呼ばれた後に DB が更新される（因果順序）
// - cancel: Stripe 失敗時は DB 未更新で 500 を返す
// - cancel: owner 以外は 403
// - cancel: grace_period 中は 409
// - reactivate: stripeSubscriptionId が undefined なら 409 + redirectTo
// - reactivate: owner 以外は 403
// - reactivate: grace_period 以外は 409

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockCancelSubscription = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			updateTenantStripe: mockUpdateTenantStripe,
		},
	}),
}));

vi.mock('$lib/server/services/stripe-service', () => ({
	cancelSubscription: (...args: unknown[]) => mockCancelSubscription(...args),
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyCancellation: vi.fn().mockResolvedValue(undefined),
	notifyCancellationReverted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks
const { POST: cancelPOST } = await import('../../../src/routes/api/v1/admin/tenant/cancel/+server');
const { POST: reactivatePOST } = await import(
	'../../../src/routes/api/v1/admin/tenant/reactivate/+server'
);

// ---------- Helpers ----------

type TenantOverrides = {
	status?: 'active' | 'suspended' | 'grace_period' | 'terminated';
	stripeSubscriptionId?: string | undefined;
	stripeCustomerId?: string | undefined;
	plan?: 'monthly' | 'yearly' | 'family-monthly' | 'family-yearly' | undefined;
};

function makeTenant(overrides: TenantOverrides = {}) {
	return {
		tenantId: 't-test',
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: 'sub_123',
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

type Role = 'owner' | 'parent' | 'child';

function makeEvent(role: Role = 'owner', tenantId = 't-test') {
	return {
		locals: {
			context: { tenantId, role },
			identity: { type: 'cognito', userId: 'u-owner', email: 'owner@example.com' },
		},
	} as unknown as Parameters<typeof cancelPOST>[0];
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTenantById.mockResolvedValue(makeTenant());
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockCancelSubscription.mockResolvedValue({ status: 'cancelled', subscriptionId: 'sub_123' });
});

// ==========================================================
// cancel
// ==========================================================

describe('POST /api/v1/admin/tenant/cancel (#784)', () => {
	it('owner 以外は 403', async () => {
		const res = (await cancelPOST(makeEvent('parent'))) as Response;
		expect(res.status).toBe(403);
		expect(mockCancelSubscription).not.toHaveBeenCalled();
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('テナントが存在しない場合 404', async () => {
		mockFindTenantById.mockResolvedValueOnce(undefined);
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(404);
		expect(mockCancelSubscription).not.toHaveBeenCalled();
	});

	it('既に grace_period なら 409', async () => {
		mockFindTenantById.mockResolvedValueOnce(makeTenant({ status: 'grace_period' }));
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(mockCancelSubscription).not.toHaveBeenCalled();
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('既に terminated なら 409', async () => {
		mockFindTenantById.mockResolvedValueOnce(makeTenant({ status: 'terminated' }));
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(mockCancelSubscription).not.toHaveBeenCalled();
	});

	it('Stripe cancel が成功した場合、DB を grace_period に更新する', async () => {
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(200);
		const body = await jsonOf(res);
		expect(body.success).toBe(true);
		expect(body.stripeCancelStatus).toBe('cancelled');
		expect(body.graceEndAt).toEqual(expect.any(String));

		// 因果順序: Stripe cancel が先、DB 更新が後
		expect(mockCancelSubscription).toHaveBeenCalledWith('t-test');
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'grace_period' }),
		);
		// 呼び出し順序の検証
		const cancelOrder = mockCancelSubscription.mock.invocationCallOrder[0];
		const updateOrder = mockUpdateTenantStripe.mock.invocationCallOrder[0];
		expect(cancelOrder).toBeDefined();
		expect(updateOrder).toBeDefined();
		expect(cancelOrder as number).toBeLessThan(updateOrder as number);
	});

	it('Stripe cancel が失敗した場合、DB は更新されず 500 を投げる', async () => {
		mockCancelSubscription.mockRejectedValueOnce(new Error('Stripe API down'));
		await expect(cancelPOST(makeEvent())).rejects.toMatchObject({ status: 500 });
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('Stripe が既にキャンセル済み (already_cancelled) でも grace_period に遷移する', async () => {
		mockCancelSubscription.mockResolvedValueOnce({
			status: 'already_cancelled',
			subscriptionId: 'sub_123',
		});
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(200);
		const body = await jsonOf(res);
		expect(body.stripeCancelStatus).toBe('already_cancelled');
		expect(mockUpdateTenantStripe).toHaveBeenCalled();
	});
});

// ==========================================================
// reactivate
// ==========================================================

describe('POST /api/v1/admin/tenant/reactivate (#784)', () => {
	it('owner 以外は 403', async () => {
		const res = (await reactivatePOST(makeEvent('parent'))) as Response;
		expect(res.status).toBe(403);
	});

	it('テナントが存在しない場合 404', async () => {
		mockFindTenantById.mockResolvedValueOnce(undefined);
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(404);
	});

	it('grace_period 以外は 409', async () => {
		mockFindTenantById.mockResolvedValueOnce(makeTenant({ status: 'active' }));
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('Stripe Subscription が undefined の場合は 409 + redirectTo=/pricing を返す', async () => {
		mockFindTenantById.mockResolvedValueOnce(
			makeTenant({ status: 'grace_period', stripeSubscriptionId: undefined }),
		);
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		const body = await jsonOf(res);
		expect(body.reason).toBe('subscription_cancelled');
		expect(body.redirectTo).toBe('/pricing');
		// 重要: DB は更新されない
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('Stripe Subscription が残っている場合のみ DB を active に戻す（防御的経路）', async () => {
		mockFindTenantById.mockResolvedValueOnce(
			makeTenant({ status: 'grace_period', stripeSubscriptionId: 'sub_still_alive' }),
		);
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(200);
		const body = await jsonOf(res);
		expect(body.success).toBe(true);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'active', planExpiresAt: undefined }),
		);
	});
});
