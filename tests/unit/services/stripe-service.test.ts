// tests/unit/services/stripe-service.test.ts
// Stripe決済サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Mocks ----------

const mockFindTenantById = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockFindTenantByStripeCustomerId = vi.fn();

// #3985: `handleWebhookEvent` は dispatcher 入口で event.id dedup 台帳を参照する。
// 本 file の関心は **handler の意味論** (どの列をどう書くか / 到着順の収束) であり、
// dedup そのものではないため、ここでは「常に未処理」を返す stub を渡して handler を毎回走らせる
// (fixture の多くが event.id を持たない複数 event を連続投入するため)。
// dedup の挙動 (5 handler の重複到達 = 副作用 1 回 / retryCount / 失敗時の非記録) は
// `tests/unit/services/stripe-webhook-dedup.test.ts` が実 repo 実装で検証する。
const mockWebhookEventClaim = vi.fn();
const mockWebhookEventRelease = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			updateTenantStripe: mockUpdateTenantStripe,
			findTenantByStripeCustomerId: mockFindTenantByStripeCustomerId,
		},
		webhookEvent: {
			findByEventId: async () => null,
			// #4128: dedup は insert-first。ここでは常に処理権を取れる状態にして
			// handler 本体の挙動だけを見る (並列到達の検証は stripe-webhook-dedup.test.ts)。
			claim: (...args: unknown[]) => {
				mockWebhookEventClaim(...args);
				return Promise.resolve(true);
			},
			finalize: async () => {},
			releaseClaim: (...args: unknown[]) => {
				mockWebhookEventRelease(...args);
				return Promise.resolve();
			},
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
	// #4286: checkout は `getPriceId()` 経由で Price を解決する（`plan.priceId` 直読をやめた）。
	// 本 file は他の関心（webhook 意味論 / session 引数）を見るため、解決自体は素通しにする。
	// **env × flag の組合せの検証は `stripe-checkout-price-resolution.test.ts`**（config を
	// mock せず実物で動かす。この file が config を丸ごと mock していたことが、
	// 「flag が死んでいる」を見逃した理由そのもの）。
	getPriceId: async (plan: string) =>
		plan === 'premium' ? 'price_family_monthly_789' : 'price_monthly_123',
	lookupPlanOf: (planId: string) => {
		if (planId === 'monthly') return 'standard';
		if (planId === 'family-monthly') return 'premium';
		return null;
	},
	getWebhookSecret: () => 'whsec_test',
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

// #3960: plan 未解決時は silent fallback せず alert を上げる。発火を assert するため spy 化。
const mockNotifyStripeAlert = vi.fn();
vi.mock('$lib/server/stripe/alert', () => ({
	notifyStripeAlert: (...args: unknown[]) => mockNotifyStripeAlert(...args),
}));

// #3981: 「Stripe API 障害」と「tenant 不在」がログ本文で区別できることを assert するため、
// logger を spy 化して呼び出し引数を検査できるようにする。
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
 * **現行契約を持つ** tenant の mock (#4026)。
 *
 * 契約状態を書き換える webhook (`invoice.paid` / `invoice.payment_failed` /
 * `customer.subscription.updated` / `...deleted`) は、event 対象の subscription が
 * tenant の現行契約であるときだけ適用される。したがって「その webhook が適用される」
 * ことを検証する fixture は、tenant 側にも同じ subscription が割り当たっている必要がある
 * (割り当てが無い tenant = 契約未確立 or 解約済み)。
 */
function makeSubscribedTenant(overrides: Record<string, unknown> = {}) {
	return makeTenant({ stripeSubscriptionId: 'sub_123', ...overrides });
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

	// #3982: 解約 (customer.subscription.deleted) 後に `stripe_subscription_id` が残っていると
	// この経路が ALREADY_SUBSCRIBED を返し、**再購読導線が塞がる**。クリアが効いていることを
	// 「解約後の tenant 形状で checkout が通る」側から固定する (上の ALREADY_SUBSCRIBED と対)。
	it('解約後 (subscriptionId クリア済み) のテナントは再購読の checkout を開始できる (#3982)', async () => {
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: undefined, plan: undefined, status: 'suspended' }),
		);
		const result = await createCheckoutSession({
			tenantId: 't-test',
			planId: 'monthly',
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});
		expect(result).toEqual({ url: 'https://checkout.stripe.com/session_1' });
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
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant());

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
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant({ plan: 'monthly' }));

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
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant({ plan: 'monthly' }));

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
		mockFindTenantByStripeCustomerId.mockResolvedValue(
			makeSubscribedTenant({ plan: 'family-monthly' }),
		);

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		// plan キー自体が渡らない = repo 実装 (`if (data.plan !== undefined)`) で既存値保持
		// #4118: 猶予終了日は同時に落とす (active + 期限残り = matrix X3)。
		// plan を書かないことは `not.toHaveProperty` で明示し、列追加で緩まないようにする。
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith('t-test', {
			status: 'active',
			planExpiresAt: null,
		});
		expect(mockUpdateTenantStripe.mock.calls.at(-1)?.[1]).not.toHaveProperty('plan');
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-plan-unresolved' }),
		);
	});

	it('#3960 — customer.subscription.updated → invoice.paid の順で最終 plan が premium になる', async () => {
		const subscription = makeSubscription('price_family_monthly_789');
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
		});
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant({ plan: 'monthly' }));
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant({ plan: 'monthly' }));

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
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant({ plan: 'monthly' }));
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant({ plan: 'monthly' }));

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
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant({ plan: 'family-monthly' }));

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

		// 本 test の不変条件は「**plan を上書きしない**」であって「patch が status 1 列だけ」ではない。
		// #4181 で `active` 復帰時に猶予終了日を消す列 (`planExpiresAt: null`) が増えたため、
		// 完全一致では列追加のたびに落ちる。**意図を直接 assert する形に強める** —
		// `plan` が patch に現れないことを明示検査する (ADR-0006: 弱体化ではなく的の明確化)。
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'active' }),
		);
		const updatedPatch = mockUpdateTenantStripe.mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(updatedPatch, 'plan 未解決なのに plan を書いている').not.toHaveProperty('plan');
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
			// 実 Stripe subscription は必ず id / status を持つ。id は「この event が
			// tenant の現行契約を指すか」の突合に使われる (#4026)
			id: 'sub_123',
			customer: 'cus_123',
			status: 'past_due',
		});
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: mockSubscriptionsRetrieve },
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant());

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
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());

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
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());

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

	// #3982: 旧 assertion は `stripeSubscriptionId: undefined` / `plan: undefined` を期待しており、
	// **no-op をそのまま追認していた** (updateTenantStripe は undefined = 更新しない)。
	// クリアの意図を DB まで届かせるには null でなければならないため、null を固定する。
	it('customer.subscription.deleted → suspended + subscriptionId/plan を null でクリア (#3982)', async () => {
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());

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
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith('t-test', {
			status: 'suspended',
			stripeSubscriptionId: null,
			plan: null,
			// #4026: 終端状態は契約に紐づく列を網羅的に書く (期限だけ残る孤児を作らない)
			planExpiresAt: null,
		});
		// stripeCustomerId は再購読時の customer 再利用 + webhook 逆引きの鍵なので消さない
		expect(mockUpdateTenantStripe.mock.calls[0]?.[1]).not.toHaveProperty('stripeCustomerId');
	});

	// ======================================================
	// #3982: 解約の終端状態が「後着イベント」で巻き戻らないこと
	//
	// Stripe は webhook の配信順序を保証しない (公式)。解約時は
	// `customer.subscription.updated` (status=canceled) と `customer.subscription.deleted` が
	// **両方**飛び、さらに当期分の `invoice.paid` / `invoice.payment_failed` が後着し得る。
	// #3982 で `deleted` が実際に NULL を書くようになったため、後着イベントが
	// 契約ありきの状態 (ACTIVE / GRACE_PERIOD / plan) を書き戻すと
	// 「subscription 参照なし・plan あり」「解約済みなのに ACTIVE」という不整合が生まれる。
	// 終端状態 (canceled / incomplete_expired) を検出して skip / 収束させることで担保する。
	// ======================================================

	/** 解約済み tenant の形状 (deleted 適用後に DB から読み直したときの値) */
	function makeCancelledTenant() {
		return makeTenant({ stripeSubscriptionId: undefined, plan: undefined, status: 'suspended' });
	}

	const TERMINAL_STATE = {
		status: 'suspended',
		stripeSubscriptionId: null,
		plan: null,
		planExpiresAt: null,
	};

	function deletedEvent(subscriptionId = 'sub_123') {
		return {
			type: 'customer.subscription.deleted',
			data: { object: { id: subscriptionId, metadata: { tenantId: 't-test' } } },
		};
	}

	function cancelledUpdatedEvent(priceId = 'price_family_monthly_789') {
		return {
			type: 'customer.subscription.updated',
			data: {
				object: {
					...makeSubscription(priceId, { status: 'canceled' }),
					metadata: { tenantId: 't-test' },
				},
			},
		};
	}

	it('#3982 — deleted → updated(canceled) の順でも plan が復活せず終端状態に収束する', async () => {
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());

		await handleWebhookEvent(deletedEvent() as never);
		// deleted 適用後の tenant を読む (id / plan はクリア済み)
		mockFindTenantById.mockResolvedValue(makeCancelledTenant());
		await handleWebhookEvent(cancelledUpdatedEvent() as never);

		// 書き込まれた状態は全て終端 = 到着順に依らず収束する。
		// #4026 以降、2 通目は「割り当ての無い tenant への event」として適用されない
		// (先着が既に終端へ収束させているので、最終状態は変わらない)。
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		for (const call of mockUpdateTenantStripe.mock.calls) {
			expect(call[1]).toEqual(TERMINAL_STATE);
		}
	});

	it('#3982 — updated(canceled) → deleted の逆順でも最終状態が一致する', async () => {
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());

		await handleWebhookEvent(cancelledUpdatedEvent() as never);
		mockFindTenantById.mockResolvedValue(makeCancelledTenant());
		await handleWebhookEvent(deletedEvent() as never);

		// 逆順でも同じ: 先着が終端へ収束させ、後着は現行契約を指さないため適用されない
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		for (const call of mockUpdateTenantStripe.mock.calls) {
			expect(call[1]).toEqual(TERMINAL_STATE);
		}
	});

	it('#3982 — 解約後に invoice.paid が後着しても status が active に戻らない', async () => {
		// Stripe から retrieve される現行 subscription は canceled (終端)
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi
					.fn()
					.mockResolvedValue(makeSubscription('price_monthly_123', { status: 'canceled' })),
			},
		});
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeCancelledTenant());

		await handleWebhookEvent(deletedEvent() as never);
		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		// deleted の 1 回だけ。invoice.paid は終端検出で skip されるため書き込まない
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		expect(mockUpdateTenantStripe.mock.calls[0]?.[1]).toEqual(TERMINAL_STATE);
	});

	it('#3982 — 解約後に invoice.payment_failed が後着しても grace_period に戻らない', async () => {
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi
					.fn()
					.mockResolvedValue(makeSubscription('price_monthly_123', { status: 'canceled' })),
			},
		});
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeCancelledTenant());

		await handleWebhookEvent(deletedEvent() as never);
		await handleWebhookEvent({
			type: 'invoice.payment_failed',
			data: { object: { parent: { subscription_details: { subscription: 'sub_123' } } } },
		} as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		expect(mockUpdateTenantStripe.mock.calls[0]?.[1]).toEqual(TERMINAL_STATE);
	});

	// #4118: 上の 2 件は tenant 側の割り当てが **既にクリア済み** (deleted 適用後) の後着を見ている。
	// その形では終端判定を外しても #4026 の突合 (現行契約と event 対象の一致) が代わりに弾くため、
	// **終端判定そのものが効いているかは検証されていなかった** (mutation で実測)。
	//
	// 検証すべきは `deleted` が**まだ届いていない**間に、Stripe 上では既に canceled になった
	// subscription の invoice event が届く形。tenant はまだ sub を持つので突合は通り、
	// 終端判定だけが「解約済み契約を課金中/猶予中として書き戻す」のを止めている。
	// これを落とすと、顧客の画面は課金中のまま Stripe には契約が無い状態になる。

	it('#3982 — deleted 未着でも、現行 subscription が canceled なら invoice.paid は書き込まない', async () => {
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi
					.fn()
					.mockResolvedValue(makeSubscription('price_monthly_123', { status: 'canceled' })),
			},
		});
		// tenant は sub_123 を保持したまま (deleted がまだ適用されていない)
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant());

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('#3982 — deleted 未着でも、現行 subscription が canceled なら invoice.payment_failed は書き込まない', async () => {
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi
					.fn()
					.mockResolvedValue(makeSubscription('price_monthly_123', { status: 'canceled' })),
			},
		});
		mockFindTenantById.mockResolvedValue(makeSubscribedTenant());
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant());

		await handleWebhookEvent({
			type: 'invoice.payment_failed',
			data: { object: { parent: { subscription_details: { subscription: 'sub_123' } } } },
		} as never);

		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('#3982 — 終端でない subscription (past_due) の invoice.payment_failed は従来どおり grace_period にする', async () => {
		// 終端判定が「解約以外まで巻き込んで無効化」していないことの対照 (guard の空振り検出)
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi
					.fn()
					.mockResolvedValue(makeSubscription('price_monthly_123', { status: 'past_due' })),
			},
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant());

		await handleWebhookEvent({
			type: 'invoice.payment_failed',
			data: { object: { parent: { subscription_details: { subscription: 'sub_123' } } } },
		} as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'grace_period' }),
		);
	});

	// ======================================================
	// #4026 / #4055: 契約状態の書き換えは「event 対象 = tenant の現行契約」のときだけ
	//
	// tenant の同定は `subscription.metadata.tenantId` (無ければ customer 逆引き) で行うため、
	// **その tenant が今どの subscription を持っているか**とは独立に handler へ到達する。
	// 突合が無いと (a) 旧 subscription の後着 event が現行契約を壊し
	// (b) 解約済み (割り当て NULL) の tenant に非終端 event が plan / ACTIVE を書き戻す。
	// ======================================================

	function updatedEvent(
		subscriptionId: string,
		status = 'active',
		priceId = 'price_family_monthly_789',
	) {
		return {
			type: 'customer.subscription.updated',
			data: {
				object: {
					...makeSubscription(priceId, { status, id: subscriptionId }),
					metadata: { tenantId: 't-test' },
				},
			},
		};
	}

	it('#4026 — 旧 sub の deleted が後着しても、再購読済み tenant の現行契約を壊さない', async () => {
		// 解約 → 再購読を通った tenant。現行契約は sub_new (課金中)。
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: 'sub_new', plan: 'family-monthly', status: 'active' }),
		);

		await handleWebhookEvent(deletedEvent('sub_old') as never);

		// 旧契約の event で現行契約の列を 1 つも書かない
		// (書くと id=NULL → createCheckoutSession の ALREADY_SUBSCRIBED ガードが外れ二重課金し得る)
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'stripe-contract-target-mismatch',
				tags: expect.objectContaining({
					tenantId: 't-test',
					eventSubscriptionId: 'sub_old',
					currentSubscriptionId: 'sub_new',
				}),
			}),
		);
	});

	it('#4026 — 旧 sub の updated(active) が後着しても、再購読済み tenant の plan を巻き戻さない', async () => {
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: 'sub_new', plan: 'family-monthly', status: 'active' }),
		);

		await handleWebhookEvent(updatedEvent('sub_old', 'active', 'price_monthly_123') as never);

		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('#4026 — 終端状態は planExpiresAt も含めて網羅的に書く (孤児列を残さない)', async () => {
		// アプリ内解約 (`/api/v1/admin/tenant/cancel`) は grace_period + planExpiresAt を書いてから
		// Stripe を即時キャンセルする。直後の deleted が planExpiresAt を書かないと、
		// 契約が無いのに期限だけ残る (SaasLicensePanel / lifecycle-email-service が読む)。
		mockFindTenantById.mockResolvedValue(
			makeSubscribedTenant({ status: 'grace_period', planExpiresAt: '2026-08-28T00:00:00Z' }),
		);

		await handleWebhookEvent(deletedEvent() as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledWith('t-test', {
			status: 'suspended',
			stripeSubscriptionId: null,
			plan: null,
			planExpiresAt: null,
		});
	});

	it('#4055 — deleted の後に非終端 updated(active) が後着しても終端状態を維持する', async () => {
		mockFindTenantById.mockResolvedValueOnce(makeSubscribedTenant());
		await handleWebhookEvent(deletedEvent() as never);

		// deleted 適用後の tenant を読む (割り当てはクリア済み)
		mockFindTenantById.mockResolvedValue(makeCancelledTenant());
		await handleWebhookEvent(updatedEvent('sub_123', 'active') as never);

		// 2 通目は「現行契約でない」として適用されない = plan / ACTIVE が復活しない
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		expect(mockUpdateTenantStripe.mock.calls[0]?.[1]).toEqual(TERMINAL_STATE);
	});

	// ======================================================
	// #4077 (PO 決裁 Q1 条件): 割り当て NULL の tenant への mismatch は
	// 「event の subscription が生きているか」で沈黙させ方を変える。
	//
	// 「Stripe 上は課金中なのに DB に割り当てが無い」= 親は請求だけ増え、子供側の機能は
	// 開かない最悪クラスの失敗モードで、しかも顧客からは原因が見えない。warn (誰も見ない)
	// では問い合わせが来るまで発見されないため alert を上げる。
	// 逆に解約済み契約への後着 (終端) は正常な skip なので鳴らさない (alert 疲れの回避)。
	// ======================================================

	it('#4077 — 割り当て NULL の tenant に非終端 event が来たら alert を上げる', async () => {
		// checkout webhook の恒久失敗 / Dashboard 手動作成で生じる「課金済み未紐付け」tenant。
		mockFindTenantById.mockResolvedValue(makeCancelledTenant());

		await handleWebhookEvent(updatedEvent('sub_live', 'active') as never);

		// 適用しない判断は #4026 のまま (割り当て前の event を書き込む方が危険)
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'stripe-contract-target-mismatch',
				tags: expect.objectContaining({
					tenantId: 't-test',
					event: 'customer.subscription.updated',
					eventSubscriptionId: 'sub_live',
					currentSubscriptionId: 'none',
					mismatchKind: 'tenant-unassigned-live-subscription',
				}),
			}),
		);
	});

	it('#4077 — 割り当て NULL の tenant への終端 event は alert を上げない (正常な後着)', async () => {
		mockFindTenantById.mockResolvedValue(makeCancelledTenant());

		// deleted (= 契約消滅) と updated(canceled) の両方が終端扱い
		await handleWebhookEvent(deletedEvent('sub_gone') as never);
		await handleWebhookEvent(cancelledUpdatedEvent() as never);

		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockNotifyStripeAlert).not.toHaveBeenCalled();
	});

	// ==========================================================
	// #3980: subscription item が複数になった瞬間に先頭参照が壊れることを検知する
	// ==========================================================

	it('#3980 — subscription item が複数なら alert を上げる (plan 解決自体は先頭のまま)', async () => {
		// add-on / 従量課金 item が 1 つ足された瞬間、`items.data[0]` が plan を表す item
		// である保証は消える。挙動 (先頭参照) は変えず、前提が崩れたことだけを観測する。
		const multiItemSubscription = {
			id: 'sub_multi',
			customer: 'cus_123',
			status: 'active',
			metadata: {},
			items: {
				data: [
					{ price: { id: 'price_family_monthly_789', lookup_key: null } },
					{ price: { id: 'price_addon_seat', lookup_key: null } },
				],
			},
		};
		mockGetStripeClient.mockReturnValue({
			subscriptions: { retrieve: vi.fn().mockResolvedValue(multiItemSubscription) },
		});
		// #4026: 契約状態の書き換えは「event 対象 = tenant の現行契約」でのみ適用されるため、
		// 適用まで見る fixture は tenant 側にも同じ subscription が割り当たっている必要がある。
		mockFindTenantByStripeCustomerId.mockResolvedValue(
			makeSubscribedTenant({ stripeSubscriptionId: 'sub_multi', plan: 'monthly' }),
		);

		await handleWebhookEvent(makeProrationInvoicePaidEvent('sub_multi') as never);

		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'stripe-subscription-multi-item',
				tags: expect.objectContaining({ subscriptionId: 'sub_multi', itemCount: 2 }),
			}),
		);
		// 壊れていない挙動は変えない: 先頭 item から plan は従来どおり解決される
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			't-test',
			expect.objectContaining({ status: 'active', plan: 'family-monthly' }),
		);
	});

	it('#3980 — subscription item が 1 件なら multi-item alert は飛ばない (誤発火の回帰)', async () => {
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi.fn().mockResolvedValue(makeSubscription('price_family_monthly_789')),
			},
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(makeSubscribedTenant({ plan: 'monthly' }));

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockNotifyStripeAlert).not.toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-subscription-multi-item' }),
		);
	});

	// ==========================================================
	// #3981: context 解決失敗の 4 経路を分離する。
	// 旧 bare `catch {}` はこれらをすべて `undefined` に潰しており、呼び出し側からは
	// 一律「tenant not found」にしか見えなかった。
	//   (1) Stripe API 障害   → alert (reason=stripe_api_error) + error ログ
	//   (2) repo (DB) 障害    → alert (reason=repo_error)       + error ログ
	//   (3) customer 参照なし → alert なし (payload の事実) + 専用 warn
	//   (4) tenant 不在       → alert なし (正常な結果)     + 専用 warn
	// 各 test は **本 PR が追加した固有のログ本文**を pin する。呼び出し側の既存 warn
	// (`invoice.paid — tenant not found for subscription=`) でも満たせる緩い部分一致
	// (例: `includes('tenant')`) にすると、新規コードを消しても PASS してしまう。
	// ==========================================================

	it('#3981 — subscriptions.retrieve が throw したら Stripe API 障害として alert + error ログを出す', async () => {
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi.fn().mockRejectedValue(new Error('Stripe API connection error')),
			},
		});

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'stripe-context-unresolved',
				// throttle key (= `path:errorSummary`) は reason 単位。subscriptionId を含めると
				// 広域障害で subscription 数ぶん Discord に飛ぶため、集約されることを固定する。
				errorSummary: 'context_unresolved:stripe_api_error',
				tags: expect.objectContaining({ reason: 'stripe_api_error', subscriptionId: 'sub_123' }),
			}),
		);
		// ログ本文で「API 障害」と判別できること (tenant 不在 / データストア障害と同じ文言に潰れない)
		const errorLogs = mockLogger.error.mock.calls.map((c) => String(c[0]));
		expect(
			errorLogs.some(
				(line) =>
					line.includes('subscription context の解決に失敗しました (Stripe API 障害)') &&
					line.includes('reason=stripe_api_error'),
			),
		).toBe(true);
		// 取り違え防止: DB 側障害の label が混ざっていない
		expect(errorLogs.some((line) => line.includes('データストア障害'))).toBe(false);
		// 返り値の契約は不変: tenant 未解決なので DB 更新は起きない
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('#3981 — tenant 逆引きが throw したらデータストア障害として区別して alert を上げる', async () => {
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi.fn().mockResolvedValue(makeSubscription('price_monthly_123')),
			},
		});
		mockFindTenantByStripeCustomerId.mockRejectedValue(new Error('DSQL connection refused'));

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'stripe-context-unresolved',
				tags: expect.objectContaining({ reason: 'repo_error' }),
			}),
		);
		// #3981 AC3 の両側: tags だけでなく **ログ本文でも** DB 側障害と判別できること。
		// label 引数を 'Stripe API 障害' に取り違えたら落ちる。
		const errorLogs = mockLogger.error.mock.calls.map((c) => String(c[0]));
		expect(
			errorLogs.some(
				(line) =>
					line.includes('subscription context の解決に失敗しました (データストア障害)') &&
					line.includes('reason=repo_error'),
			),
		).toBe(true);
		expect(errorLogs.some((line) => line.includes('Stripe API 障害'))).toBe(false);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('#3981 — subscription に customer 参照が無ければ alert は飛ばず専用 warn に留まる', async () => {
		// Stripe の payload としてはあり得る形 (deleted customer 等)。障害ではないので
		// alert を鳴らさないが、tenant 不在とは別の事実なので専用 warn で区別する。
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi
					.fn()
					.mockResolvedValue({ ...makeSubscription('price_monthly_123'), customer: null }),
			},
		});

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockNotifyStripeAlert).not.toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-context-unresolved' }),
		);
		// customer 逆引き自体に到達しない (customer が無いので repo を呼ばない)
		expect(mockFindTenantByStripeCustomerId).not.toHaveBeenCalled();
		const warnLogs = mockLogger.warn.mock.calls.map((c) => String(c[0]));
		expect(
			warnLogs.some((line) =>
				line.includes('subscription に customer 参照がありません: subscription=sub_123'),
			),
		).toBe(true);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('#3981 — tenant が本当に不在なだけなら alert は飛ばず warn に留まる (誤発火の回帰)', async () => {
		mockGetStripeClient.mockReturnValue({
			subscriptions: {
				retrieve: vi.fn().mockResolvedValue(makeSubscription('price_monthly_123')),
			},
		});
		mockFindTenantByStripeCustomerId.mockResolvedValue(undefined);

		await handleWebhookEvent(makeProrationInvoicePaidEvent() as never);

		expect(mockNotifyStripeAlert).not.toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-context-unresolved' }),
		);
		// 本 PR が `resolveSubscriptionContext` に追加した warn **だけ**を pin する。
		// `includes('tenant')` では呼び出し側の既存 warn
		// (`invoice.paid — tenant not found for subscription=`) でも真になり、
		// 新規 warn を消しても PASS してしまう (mutation 生存)。
		const warnLogs = mockLogger.warn.mock.calls.map((c) => String(c[0]));
		expect(
			warnLogs.some(
				(line) =>
					line.includes('customer に対応する tenant が見つかりません (tenant 不在)') &&
					line.includes('customer=cus_123'),
			),
		).toBe(true);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('未対応のイベント型 → エラーなし', async () => {
		const event = {
			type: 'payment_intent.created',
			data: { object: {} },
		};
		await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
	});
});
