// tests/unit/services/stripe-paid-contract-restore.test.ts
// #4708: 有料契約の確定 (W1 checkout / W2 invoice.paid / W4 subscription.updated=active) で、
// 無料プランの上限により archive されたお子さま / 活動 / チェックリストを復元する。
// 復元関数 `restoreArchivedResources` の呼び手は以前 `POST /api/v1/admin/downgrade-restore` だけで、
// Stripe 経路 (= 顧客が実際に有料化する経路) から一切呼ばれていなかった (caller 0)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockFindTenantByStripeCustomerId = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			updateTenantStripe: mockUpdateTenantStripe,
			findTenantByStripeCustomerId: mockFindTenantByStripeCustomerId,
		},
		trialHistory: {
			findLatestByTenant: async () => undefined,
			updateConversion: async () => {},
		},
		webhookEvent: {
			findByEventId: async () => null,
			claim: async () => true,
			finalize: async () => {},
			releaseClaim: async () => {},
			incrementRetryCount: async () => {},
			deleteOlderThan: async () => 0,
		},
	}),
}));

const mockIsStripeEnabled = vi.fn();
const mockGetStripeClient = vi.fn();

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: (...args: unknown[]) => mockIsStripeEnabled(...args),
	getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
	}),
	planIdFromPriceId: (priceId: string) => (priceId === 'price_monthly_123' ? 'monthly' : null),
	planIdFromLookupKey: () => null,
	getWebhookSecret: () => 'whsec_test',
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/stripe/alert', () => ({ notifyStripeAlert: vi.fn() }));

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: (...args: unknown[]) => mockLogger.info(...args),
		warn: (...args: unknown[]) => mockLogger.warn(...args),
		error: (...args: unknown[]) => mockLogger.error(...args),
	},
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockRestoreArchivedResources = vi.fn();
const mockArchiveExcessResources = vi.fn();

vi.mock('$lib/server/services/resource-archive-service', () => ({
	restoreArchivedResources: (...args: unknown[]) => mockRestoreArchivedResources(...args),
	archiveExcessResources: (...args: unknown[]) => mockArchiveExcessResources(...args),
}));

import { handleWebhookEvent } from '../../../src/lib/server/services/stripe-service';

const SUB_ID = 'sub_paid';
const TENANT_ID = 't-paid';

function tenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: TENANT_ID,
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_paid',
		stripeSubscriptionId: SUB_ID,
		planExpiresAt: null,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

function subscription(status: string) {
	return {
		id: SUB_ID,
		customer: 'cus_paid',
		status,
		metadata: { tenantId: TENANT_ID },
		items: { data: [{ price: { id: 'price_monthly_123', lookup_key: null } }] },
	};
}

const checkoutEvent = {
	id: 'evt_checkout',
	type: 'checkout.session.completed',
	data: {
		object: {
			id: 'cs_test',
			metadata: { tenantId: TENANT_ID, planId: 'monthly' },
			customer: 'cus_paid',
			subscription: SUB_ID,
			customer_details: { email: 'test@example.com' },
			customer_email: null,
		},
	},
};

const invoicePaidEvent = {
	id: 'evt_invoice_paid',
	type: 'invoice.paid',
	data: {
		object: {
			parent: { subscription_details: { subscription: SUB_ID } },
			lines: {
				data: [{ amount: 500, pricing: { price_details: { price: 'price_monthly_123' } } }],
			},
		},
	},
};

function subscriptionUpdatedEvent(status: string) {
	return {
		id: `evt_sub_updated_${status}`,
		type: 'customer.subscription.updated',
		data: { object: subscription(status) },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockRestoreArchivedResources.mockResolvedValue(undefined);
	mockArchiveExcessResources.mockResolvedValue({
		archivedChildIds: [],
		archivedActivityIds: [],
		archivedChecklistTemplateIds: [],
	});
});

describe('#4708 有料契約の確定で archive を復元する', () => {
	it('W1 checkout.session.completed (S1/S5 → S2): 契約確定後に全 reason を復元する', async () => {
		// 未契約 (trial 終了で archive 済み) のテナント
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null, plan: null }));

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(checkoutEvent as any);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			TENANT_ID,
			expect.objectContaining({ stripeSubscriptionId: SUB_ID, status: 'active' }),
		);
		expect(mockRestoreArchivedResources).toHaveBeenCalledTimes(1);
		expect(mockRestoreArchivedResources).toHaveBeenCalledWith(TENANT_ID);
		// 復元は契約確定 (updateTenantStripe) の後
		const writeOrder = mockUpdateTenantStripe.mock.invocationCallOrder[0] ?? Number.NaN;
		const restoreOrder = mockRestoreArchivedResources.mock.invocationCallOrder[0] ?? Number.NaN;
		expect(writeOrder).toBeLessThan(restoreOrder);
	});

	it('W2 invoice.paid (現行契約): 復元する (W1 未達 / dunning 復帰 S3→S2 の救済、冪等)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockFindTenantByStripeCustomerId.mockResolvedValue(tenant());
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription('active')) },
		});

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(invoicePaidEvent as any);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			TENANT_ID,
			expect.objectContaining({ status: 'active' }),
		);
		expect(mockRestoreArchivedResources).toHaveBeenCalledWith(TENANT_ID);
	});

	it('W2 invoice.paid が現行契約と一致しない (後着 / 別契約) なら契約も書かず復元もしない', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: 'sub_other' }));
		mockFindTenantByStripeCustomerId.mockResolvedValue(
			tenant({ stripeSubscriptionId: 'sub_other' }),
		);
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription('active')) },
		});

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(invoicePaidEvent as any);

		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockRestoreArchivedResources).not.toHaveBeenCalled();
	});

	it.each([
		['active', true],
		['trialing', true],
		['past_due', false],
		['unpaid', false],
		['paused', false],
	])('W4 customer.subscription.updated status=%s → 復元する=%s', async (status, shouldRestore) => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockFindTenantByStripeCustomerId.mockResolvedValue(tenant());
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription(status)) },
		});

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(subscriptionUpdatedEvent(status) as any);

		expect(mockUpdateTenantStripe).toHaveBeenCalled();
		if (shouldRestore) {
			expect(mockRestoreArchivedResources).toHaveBeenCalledWith(TENANT_ID);
		} else {
			expect(mockRestoreArchivedResources).not.toHaveBeenCalled();
		}
	});

	it('W4 終端 (canceled) / W5 deleted では復元しない (契約が消える方向)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockFindTenantByStripeCustomerId.mockResolvedValue(tenant());
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription('canceled')) },
		});

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(subscriptionUpdatedEvent('canceled') as any);
		const deletedEvent = {
			id: 'evt_deleted',
			type: 'customer.subscription.deleted',
			data: { object: subscription('canceled') },
		};
		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(deletedEvent as any);

		expect(mockRestoreArchivedResources).not.toHaveBeenCalled();
	});

	it('復元が失敗しても契約確定は巻き戻さず webhook は成功で返す (error log、次 event で再試行)', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null, plan: null }));
		mockRestoreArchivedResources.mockRejectedValue(new Error('db down'));

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await expect(handleWebhookEvent(checkoutEvent as any)).resolves.not.toBe('error');

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			TENANT_ID,
			expect.objectContaining({ status: 'active' }),
		);
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringContaining('failed to restore archived resources'),
			expect.objectContaining({ context: expect.objectContaining({ tenantId: TENANT_ID }) }),
		);
	});
});
