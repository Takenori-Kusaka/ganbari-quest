// tests/unit/services/stripe-service.test.ts
// Stripe決済サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Mocks ----------

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
		yearly: { priceId: 'price_yearly_456', amount: 5000, interval: 'year', label: '年額' },
	}),
	planIdFromPriceId: (priceId: string) => {
		if (priceId === 'price_monthly_123') return 'monthly';
		if (priceId === 'price_yearly_456') return 'yearly';
		return null;
	},
	getWebhookSecret: () => 'whsec_test',
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendLicenseKeyEmail: vi.fn().mockResolvedValue(undefined),
}));

const mockIssueLicenseKey = vi.fn();

vi.mock('$lib/server/services/license-key-service', () => ({
	issueLicenseKey: (...args: unknown[]) => mockIssueLicenseKey(...args),
}));

// ---------- Import after mocks ----------

import {
	createCheckoutSession,
	createPortalSession,
	handleWebhookEvent,
} from '../../../src/lib/server/services/stripe-service';

// ---------- Helpers ----------

function makeTenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: 't-test',
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: null,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockFindTenantById.mockResolvedValue(makeTenant());
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockIssueLicenseKey.mockResolvedValue({ licenseKey: 'LK-TEST-001' });
});

// ==========================================================
// createCheckoutSession
// ==========================================================

describe('createCheckoutSession', () => {
	const mockSessionCreate = vi.fn();

	beforeEach(() => {
		mockGetStripeClient.mockReturnValue({
			checkout: { sessions: { create: mockSessionCreate } },
		});
		mockSessionCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session_1' });
	});

	it('Stripe無効 → STRIPE_DISABLED', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		const result = await createCheckoutSession({
			tenantId: 't-test',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		expect(result).toEqual({ error: 'STRIPE_DISABLED' });
	});

	it('テナント未存在 → TENANT_NOT_FOUND', async () => {
		mockFindTenantById.mockResolvedValue(null);
		const result = await createCheckoutSession({
			tenantId: 't-none',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		expect(result).toEqual({ error: 'TENANT_NOT_FOUND' });
	});

	it('既にサブスクリプションあり → ALREADY_SUBSCRIBED', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant({ stripeSubscriptionId: 'sub_existing' }));
		const result = await createCheckoutSession({
			tenantId: 't-test',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		expect(result).toEqual({ error: 'ALREADY_SUBSCRIBED' });
	});

	it('正常にチェックアウトURL返却', async () => {
		const result = await createCheckoutSession({
			tenantId: 't-test',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		expect(result).toEqual({ url: 'https://checkout.stripe.com/session_1' });
		expect(mockSessionCreate).toHaveBeenCalledTimes(1);
	});

	it('#314: Stripe側trial_period_daysは廃止（アプリ側一元管理）', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant({ trialUsedAt: null }));
		await createCheckoutSession({
			tenantId: 't-test',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		const params = mockSessionCreate.mock.calls[0]?.[0];
		expect(params.subscription_data.trial_period_days).toBeUndefined();
	});

	it('既存Stripeカスタマー → customer が設定される', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant({ stripeCustomerId: 'cus_existing' }));
		await createCheckoutSession({
			tenantId: 't-test',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		const params = mockSessionCreate.mock.calls[0]?.[0];
		expect(params.customer).toBe('cus_existing');
	});

	it('session.url が null → INVALID_PLAN', async () => {
		mockSessionCreate.mockResolvedValue({ url: null });
		const result = await createCheckoutSession({
			tenantId: 't-test',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		expect(result).toEqual({ error: 'INVALID_PLAN' });
	});
});

// ==========================================================
// createPortalSession
// ==========================================================

describe('createPortalSession', () => {
	const mockPortalCreate = vi.fn();

	beforeEach(() => {
		mockGetStripeClient.mockReturnValue({
			billingPortal: { sessions: { create: mockPortalCreate } },
		});
		mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/portal_1' });
	});

	it('Stripe無効 → STRIPE_DISABLED', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		const result = await createPortalSession('t-test', 'https://app/settings');
		expect(result).toEqual({ error: 'STRIPE_DISABLED' });
	});

	it('テナント未存在 → TENANT_NOT_FOUND', async () => {
		mockFindTenantById.mockResolvedValue(null);
		const result = await createPortalSession('t-none', 'https://app/settings');
		expect(result).toEqual({ error: 'TENANT_NOT_FOUND' });
	});

	it('StripeカスタマーIDなし → NO_STRIPE_CUSTOMER', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant({ stripeCustomerId: undefined }));
		const result = await createPortalSession('t-test', 'https://app/settings');
		expect(result).toEqual({ error: 'NO_STRIPE_CUSTOMER' });
	});

	it('正常にポータルURL返却', async () => {
		const result = await createPortalSession('t-test', 'https://app/settings');
		expect(result).toEqual({ url: 'https://billing.stripe.com/portal_1' });
		expect(mockPortalCreate).toHaveBeenCalledWith({
			customer: 'cus_123',
			return_url: 'https://app/settings',
		});
	});
});

// ==========================================================
// handleWebhookEvent
// ==========================================================

describe('handleWebhookEvent', () => {
	it('checkout.session.completed → テナント更新 + ライセンスキー発行', async () => {
		const event = {
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test',
					metadata: { tenantId: 't-test', planId: 'monthly' },
					customer: 'cus_new',
					subscription: 'sub_new',
					customer_details: { email: 'test@example.com' },
					customer_email: null,
				},
			},
		};

		await handleWebhookEvent(event as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({
				stripeCustomerId: 'cus_new',
				stripeSubscriptionId: 'sub_new',
				plan: 'monthly',
				status: 'active',
			}),
		);

		// #801: Stripe 経由の発行は常に kind='purchase'、issuedBy に session ID を記録
		expect(mockIssueLicenseKey).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: 't-test',
				plan: 'monthly',
				stripeSessionId: 'cs_test',
				kind: 'purchase',
				issuedBy: 'stripe:cs_test',
			}),
		);
	});

	it('checkout.session.completed — metadata に tenantId なし → 何もしない', async () => {
		const event = {
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_no_tenant',
					metadata: {},
					customer: 'cus_new',
					subscription: 'sub_new',
				},
			},
		};

		await handleWebhookEvent(event as never);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('invoice.paid → テナントステータスを active に更新', async () => {
		const mockSubscriptionsRetrieve = vi.fn().mockResolvedValue({
			customer: 'cus_123',
		});
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: mockSubscriptionsRetrieve },
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant());

		const event = {
			type: 'invoice.paid',
			data: {
				object: {
					parent: {
						subscription_details: { subscription: 'sub_123' },
					},
					lines: {
						data: [
							{
								pricing: {
									price_details: { price: 'price_monthly_123' },
								},
							},
						],
					},
				},
			},
		};

		await handleWebhookEvent(event as never);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({
				status: 'active',
				plan: 'monthly',
			}),
		);
	});

	it('invoice.payment_failed → grace_period に変更', async () => {
		const mockSubscriptionsRetrieve = vi.fn().mockResolvedValue({
			customer: 'cus_123',
		});
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: mockSubscriptionsRetrieve },
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant());

		const event = {
			type: 'invoice.payment_failed',
			data: {
				object: {
					parent: {
						subscription_details: { subscription: 'sub_123' },
					},
				},
			},
		};

		await handleWebhookEvent(event as never);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({
				status: 'grace_period',
			}),
		);
	});

	it('customer.subscription.updated → ステータス反映', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant());

		const event = {
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_123',
					metadata: { tenantId: 't-test' },
					status: 'active',
					items: {
						data: [{ price: { id: 'price_monthly_123' } }],
					},
				},
			},
		};

		await handleWebhookEvent(event as never);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({
				status: 'active',
				plan: 'monthly',
			}),
		);
	});

	it('customer.subscription.updated — past_due → grace_period', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant());

		const event = {
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_123',
					metadata: { tenantId: 't-test' },
					status: 'past_due',
					items: {
						data: [{ price: { id: 'price_monthly_123' } }],
					},
				},
			},
		};

		await handleWebhookEvent(event as never);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({
				status: 'grace_period',
			}),
		);
	});

	it('customer.subscription.deleted → suspended + サブスクリプションID解除', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant());

		const event = {
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_123',
					metadata: { tenantId: 't-test' },
				},
			},
		};

		await handleWebhookEvent(event as never);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({
				status: 'suspended',
				stripeSubscriptionId: undefined,
				plan: undefined,
			}),
		);
	});

	it('未対応のイベント型 → エラーなし', async () => {
		const event = {
			type: 'payment_intent.created',
			data: { object: {} },
		};
		await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
	});
});
