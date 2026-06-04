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

// #2719 (Phase 7 PR-3b prerequisite): yearly 経路廃止に伴い `getPlans()` mock を monthly 2 種に絞る。
vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
		'family-monthly': {
			priceId: 'price_family_monthly_789',
			amount: 780,
			interval: 'month',
			label: 'プレミアム月額',
		},
	}),
	planIdFromPriceId: (priceId: string) => {
		if (priceId === 'price_monthly_123') return 'monthly';
		if (priceId === 'price_family_monthly_789') return 'family-monthly';
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

// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract。`license-key-service.ts` は PR-L3 で
// 物理削除され、`email-service.sendLicenseKeyEmail` も PR-L4 で撤去済。stripe-service は冗長層
// (issueLicenseKey / sendLicenseKeyEmail) を一切 import しないため、旧 spy mock + 「呼ばれない」
// assertion は撤去 (削除済モジュールへの vi.mock は不要、回帰は leak gate + 物理削除で構造保証)。

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
	it('checkout.session.completed → テナント更新 (entitlement = status=active、license key 経由しない)', async () => {
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

		// entitlement (Stripe Subscription) は tenant.status=active + plan で確定する。
		// 認可は stripeSubscriptionId + status から計算され license key を読まない。
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({
				stripeCustomerId: 'cus_new',
				stripeSubscriptionId: 'sub_new',
				plan: 'monthly',
				status: 'active',
			}),
		);

		// Epic #2525 Phase 7 PR-L5 (#2860): entitlement は updateTenantStripe で既付与。
		// license key 発行 / メール送信の冗長層は物理削除済 (上記 mock 撤去理由参照)。
	});

	it('checkout.session.completed — 100% OFF プロモコード (amount_total=0) でも同じフロー (#803)', async () => {
		// Stripe Dashboard で発行した 100% OFF Coupon + Promotion code が適用された Checkout
		// が完了したときの payload。`amount_total=0` / `total_details.amount_discount` が全額分
		// になるが、session.metadata と subscription は通常購入と同じ形で付与される。
		// tenant.plan / status も通常どおり昇格する（Checkout を経由していれば 100% OFF でも
		// 「Stripe で本人確認を通った正規購入」扱い）。
		const event = {
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_promo_100off',
					amount_total: 0,
					amount_subtotal: 500,
					total_details: { amount_discount: 500, amount_tax: 0, amount_shipping: 0 },
					metadata: { tenantId: 't-promo', planId: 'monthly' },
					customer: 'cus_promo',
					subscription: 'sub_promo',
					customer_details: { email: 'promo@example.com' },
					customer_email: null,
				},
			},
		};

		await handleWebhookEvent(event as never);

		// 通常購入と同じく tenant.plan と subscription が紐付けられる (entitlement)
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-promo',
			expect.objectContaining({
				stripeCustomerId: 'cus_promo',
				stripeSubscriptionId: 'sub_promo',
				plan: 'monthly',
				status: 'active',
			}),
		);

		// Epic #2525 Phase 7 PR-L5 (#2860): 100% OFF でも license key 発行の冗長層は物理削除済。
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
