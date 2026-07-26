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
	// #3960: `USE_LOOKUP_KEY=true` 経路で env var と異なる Price を指し得るため、
	// priceId 逆引き失敗時の 2 段目として lookup_key を突き合わせる。
	planIdFromLookupKey: (lookupKey: string | null | undefined) => {
		if (lookupKey === 'standard_monthly') return 'monthly';
		if (lookupKey === 'premium_monthly') return 'family-monthly';
		return null;
	},
	getWebhookSecret: () => 'whsec_test',
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

// #3960: plan 未解決時は silent fallback せず alert を上げる。発火を assert するため spy 化。
const mockNotifyStripeAlert = vi.fn();
vi.mock('$lib/server/stripe/alert', () => ({
	notifyStripeAlert: (...args: unknown[]) => mockNotifyStripeAlert(...args),
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

/**
 * Stripe subscription の mock (#3960)。
 *
 * `handleInvoicePaid` は plan を invoice の line item ではなく **subscription の現行 price**
 * から解決するため、`subscriptions.retrieve()` の戻り値に `items.data[0].price` が必要。
 */
function makeSubscription(
	priceId: string,
	overrides: { lookupKey?: string | null; status?: string; id?: string } = {},
) {
	return {
		id: overrides.id ?? 'sub_123',
		customer: 'cus_123',
		status: overrides.status ?? 'active',
		metadata: {},
		items: { data: [{ price: { id: priceId, lookup_key: overrides.lookupKey ?? null } }] },
	};
}

/**
 * プラン変更 (proration) の invoice.paid payload (#3960 実測 fixture)。
 *
 * スタンダード → プレミアム変更時、Stripe は 2 行の invoice を発行する:
 *   line 0: amount -499 / standard の未使用時間クレジット  ← 旧実装が盲目参照していた行
 *   line 1: amount  779 / premium の残り時間
 * つまり `lines.data[0]` は **変更前**の price であり、plan の SSOT にしてはならない。
 */
function makeProrationInvoicePaidEvent(subscriptionId = 'sub_123') {
	return {
		type: 'invoice.paid',
		data: {
			object: {
				parent: { subscription_details: { subscription: subscriptionId } },
				lines: {
					data: [
						{
							amount: -499,
							pricing: { price_details: { price: 'price_monthly_123' } },
						},
						{
							amount: 779,
							pricing: { price_details: { price: 'price_family_monthly_789' } },
						},
					],
				},
			},
		},
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
		const mockSubscriptionsRetrieve = vi
			.fn()
			.mockResolvedValue(makeSubscription('price_monthly_123'));
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

	// ==========================================================
	// #3960: invoice.paid の plan 解決を subscription の現行 price に寄せる
	// ==========================================================

	it('invoice.paid — proration 複数行 invoice で lines.data[0] (変更前 price) に引きずられず premium になる (#3960)', async () => {
		// 実測 (2026-07-26 本番 live subscription への create_preview):
		//   line 0 = standard の未使用時間クレジット / line 1 = premium の残り時間
		// 旧実装は line 0 を読んで plan=monthly を書き込み、プレミアム契約者を
		// スタンダード扱いに巻き戻していた。
		const mockSubscriptionsRetrieve = vi
			.fn()
			.mockResolvedValue(makeSubscription('price_family_monthly_789'));
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: mockSubscriptionsRetrieve },
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant({ plan: 'monthly' }));

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'active', plan: 'family-monthly' }),
		);
	});

	it('invoice.paid — env var と異なる Price でも lookup_key から plan を解決する (#3960 USE_LOOKUP_KEY 経路)', async () => {
		// `USE_LOOKUP_KEY=true` では lookup_key 経由で解決した Price が env var
		// (`STRIPE_PRICE_FAMILY_MONTHLY`) と別 Price を指し得る。priceId 逆引きが
		// null でも Price object の lookup_key で確定できることを担保する。
		const mockSubscriptionsRetrieve = vi
			.fn()
			.mockResolvedValue(
				makeSubscription('price_unknown_to_env', { lookupKey: 'premium_monthly' }),
			);
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: mockSubscriptionsRetrieve },
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant({ plan: 'monthly' }));

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'active', plan: 'family-monthly' }),
		);
	});

	it('invoice.paid — plan が解決できない場合は plan を上書きせず既存値を保持し alert を上げる (#3960 silent fallback 廃止)', async () => {
		// 旧実装は `plan ?? tenant.plan ?? MONTHLY` で暗黙にスタンダードへ落としていた。
		// premium 契約者の plan を誤って書き換えるより、更新せず観測する方が安全。
		const mockSubscriptionsRetrieve = vi
			.fn()
			.mockResolvedValue(makeSubscription('price_unknown_to_env', { lookupKey: null }));
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: mockSubscriptionsRetrieve },
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant({ plan: 'family-monthly' }));

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		// plan キー自体が渡らない = repo 実装 (`if (data.plan !== undefined)`) で既存値保持
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith('t-test', { status: 'active' });
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-plan-unresolved' }),
		);
	});

	it('#3960 — customer.subscription.updated → invoice.paid の順で最終 plan が premium になる', async () => {
		const subscription = makeSubscription('price_family_monthly_789');
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
		});
		mockFindTenantById.mockResolvedValue(makeTenant({ plan: 'monthly' }));
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant({ plan: 'monthly' }));

		await handleWebhookEvent({
			type: 'customer.subscription.updated',
			data: { object: { ...subscription, metadata: { tenantId: 't-test' } } },
		} as never);
		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		for (const call of mockUpdateTenantStripe.mock.calls) {
			expect(call[1].plan).toBe('family-monthly');
		}
	});

	it('#3960 — invoice.paid → customer.subscription.updated の逆順でも最終 plan が premium になる', async () => {
		// Stripe は 2 event の配信順序を保証しない。subscription を SSOT にすることで
		// どちらの順序でも最終状態が現行 price に収束することを担保する。
		const subscription = makeSubscription('price_family_monthly_789');
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
		});
		mockFindTenantById.mockResolvedValue(makeTenant({ plan: 'monthly' }));
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant({ plan: 'monthly' }));

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);
		await handleWebhookEvent({
			type: 'customer.subscription.updated',
			data: { object: { ...subscription, metadata: { tenantId: 't-test' } } },
		} as never);

		for (const call of mockUpdateTenantStripe.mock.calls) {
			expect(call[1].plan).toBe('family-monthly');
		}
	});

	it('customer.subscription.updated — plan 未解決なら plan を上書きせず alert を上げる (#3960)', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant({ plan: 'family-monthly' }));

		await handleWebhookEvent({
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_123',
					metadata: { tenantId: 't-test' },
					status: 'active',
					items: { data: [{ price: { id: 'price_unknown_to_env', lookup_key: null } }] },
				},
			},
		} as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith('t-test', { status: 'active' });
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-plan-unresolved' }),
		);
	});

	it('checkout.session.completed — 未知の metadata.planId なら plan を書かず alert を上げる (#3960)', async () => {
		await handleWebhookEvent({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_unknown_plan',
					metadata: { tenantId: 't-test', planId: 'lifetime' },
					customer: 'cus_new',
					subscription: 'sub_new',
				},
			},
		} as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'active', plan: undefined }),
		);
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-plan-unresolved' }),
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
