// tests/unit/services/stripe-checkout-price-resolution.test.ts
// #4286 — checkout が Price ID をどう解決するか。
//
// ## なぜこの test が要るか
//
// `getPriceId()`（lookup_key 解決 + env fallback）は実装済みなのに、**製品コードから 1 度も
// 呼ばれていなかった**。`createCheckoutSession` は env 直読の `getPlans().priceId` しか見ず、
// `USE_LOOKUP_KEY=true` は**どの経路にも効いていなかった**（flag が死んでいた）。
//
// 結果: `STRIPE_PRICE_*_MONTHLY` を注入しない配備（staging、#4104）では
// **購入ボタンが必ず 400「プランが正しくありません」**になり、Stripe Checkout に一度も
// 遷移しない。E1（#4117）の「staging で checkout → webhook → plan 反映 を 1 周」が
// 構造的に達成不能だった。
//
// **本番が動いていたのは price env が別途注入されていたからで、lookup_key 移行が
// 済んでいたからではない。** env を整理した瞬間に本番の課金も止まる状態だった。
//
// ## この test file が既存 stripe-service.test.ts と別なのはなぜか
//
// 既存 file は `$lib/server/stripe/config` を**丸ごと mock** している。そのため
// 「config が env をどう読むか」「flag がどちらの経路を選ぶか」を一切検証できない
// （まさにこの欠陥を見逃した理由）。本 file は **config を実物のまま使い**、
// env と flag の組合せだけを動かす。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			updateTenantStripe: vi.fn(),
			findTenantByStripeCustomerId: vi.fn(),
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

const mockSessionCreate = vi.fn();
vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
	getStripeClient: () => ({ checkout: { sessions: { create: mockSessionCreate } } }),
}));

/** lookup_key → priceId 解決（Stripe API 相当）。失敗させると kill switch 経路に入る。 */
const mockGetPriceByLookupKey = vi.fn();
vi.mock('$lib/server/stripe/price-cache', () => ({
	getPriceByLookupKey: (...args: unknown[]) => mockGetPriceByLookupKey(...args),
}));

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

vi.mock('$lib/server/request-context', () => ({ invalidateRequestCaches: vi.fn() }));

import { createCheckoutSession } from '$lib/server/services/stripe-service';

const ENV_KEYS = [
	'USE_LOOKUP_KEY',
	'STRIPE_PRICE_STANDARD_MONTHLY',
	'STRIPE_PRICE_FAMILY_MONTHLY',
] as const;
const savedEnv: Record<string, string | undefined> = {};

function checkout(planId: 'monthly' | 'family-monthly' = 'monthly') {
	return createCheckoutSession({
		tenantId: 't-1',
		planId,
		successUrl: 'https://app/success',
		cancelUrl: 'https://app/cancel',
	});
}

/** Stripe に渡された line_items の price。**どの Price で課金しようとしたか**が本 test の主題。 */
function requestedPriceId(): unknown {
	return mockSessionCreate.mock.calls[0]?.[0]?.line_items?.[0]?.price;
}

beforeEach(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
	vi.clearAllMocks();
	mockFindTenantById.mockResolvedValue({
		id: 't-1',
		name: 'テスト家族',
		plan: 'free',
		stripeCustomerId: null,
		stripeSubscriptionId: null,
	});
	mockSessionCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/s_1' });
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
});

describe('#4286 checkout の Price 解決', () => {
	it('AC2: price env が無くても USE_LOOKUP_KEY=true なら checkout が作れる（staging の実構成）', async () => {
		// staging (#4104) は「price id は注入せず lookup_key で解決する」構成。
		// 旧実装はここで env 直読の空文字を見て INVALID_PLAN を返し、400 になっていた。
		process.env.USE_LOOKUP_KEY = 'true';
		mockGetPriceByLookupKey.mockResolvedValue('price_from_lookup_standard');

		const result = await checkout();

		expect(result).toEqual({ url: 'https://checkout.stripe.com/s_1' });
		expect(mockGetPriceByLookupKey).toHaveBeenCalledWith('standard_monthly');
		expect(requestedPriceId()).toBe('price_from_lookup_standard');
	});

	it('AC2: premium も lookup_key で解決する（tier は family、lookup は premium と語彙が違う）', async () => {
		// `tier: 'family'` をそのまま lookup_key に使うと `family_monthly` を引いて 404 になる。
		// 語彙の差を取り違えると「標準は買えるが premium だけ買えない」形で顧客に出る。
		process.env.USE_LOOKUP_KEY = 'true';
		mockGetPriceByLookupKey.mockResolvedValue('price_from_lookup_premium');

		await checkout('family-monthly');

		expect(mockGetPriceByLookupKey).toHaveBeenCalledWith('premium_monthly');
		expect(requestedPriceId()).toBe('price_from_lookup_premium');
	});

	it('AC3: USE_LOOKUP_KEY=false × env あり（現本番の実効構成）は従来どおり env の Price を使う', async () => {
		process.env.USE_LOOKUP_KEY = 'false';
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_env_standard';

		const result = await checkout();

		expect(result).toEqual({ url: 'https://checkout.stripe.com/s_1' });
		expect(mockGetPriceByLookupKey).not.toHaveBeenCalled();
		expect(requestedPriceId()).toBe('price_env_standard');
	});

	it('AC4: lookup 解決が失敗したら env に fallback し、**黙って**は倒れない（alert を出す）', async () => {
		process.env.USE_LOOKUP_KEY = 'true';
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_env_standard';
		mockGetPriceByLookupKey.mockRejectedValue(new Error('Stripe API 障害'));

		const result = await checkout();

		expect(result).toEqual({ url: 'https://checkout.stripe.com/s_1' });
		expect(requestedPriceId()).toBe('price_env_standard');
		// kill switch が動いたこと自体が観測できなければ、次に同じことが起きても気づけない。
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-lookup-failed' }),
		);
	});

	it('AC4: lookup も env も解決できないときは、別 Price で課金せず購入を止める', async () => {
		process.env.USE_LOOKUP_KEY = 'true';
		mockGetPriceByLookupKey.mockRejectedValue(new Error('Price 未発行'));

		const result = await checkout();

		// **Stripe を一度も呼ばない**。ここで別 plan の Price に倒れると誤課金になる。
		expect(mockSessionCreate).not.toHaveBeenCalled();
		// 配備の設定不備であって顧客の選択が誤っているわけではないので、INVALID_PLAN では返さない。
		expect(result).toEqual({ error: 'PRICE_UNRESOLVED' });
	});

	it('存在しない planId は従来どおり INVALID_PLAN（Price 解決以前の入力誤り）', async () => {
		process.env.USE_LOOKUP_KEY = 'true';

		const result = await createCheckoutSession({
			tenantId: 't-1',
			// historical record 由来の値が渡る可能性に備えた既存ガード。
			planId: 'yearly' as never,
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});

		expect(result).toEqual({ error: 'INVALID_PLAN' });
		expect(mockGetPriceByLookupKey).not.toHaveBeenCalled();
	});
});

// ============================================================
// #4329 ② AC7 — 配備・設定側の異常を運用側から観測できるようにする。
//
// #4286 は「購入が必ず 400」という**全顧客に効く**設定不備が 10 日間気づかれなかった。
// 顧客側の文言を汎用に倒す (原因の所在を偽らない) 以上、原因の特定は運用側の通知が担う。
// ============================================================

describe('#4329 checkout の設定不備を観測可能にする', () => {
	it('認証済 tenant が repo に無いとき alert を上げる (顧客の状態ではなくデータ側の異常)', async () => {
		process.env.USE_LOOKUP_KEY = 'true';
		mockFindTenantById.mockResolvedValue(null);

		const result = await checkout();

		expect(result).toEqual({ error: 'TENANT_NOT_FOUND' });
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-checkout-misconfigured' }),
		);
	});

	it('plan 設定が欠けているとき alert を上げる (顧客の選択誤りとして黙らせない)', async () => {
		process.env.USE_LOOKUP_KEY = 'true';

		const result = await createCheckoutSession({
			tenantId: 't-1',
			planId: 'yearly' as never,
			successUrl: 'https://app/success',
			cancelUrl: 'https://app/cancel',
		});

		expect(result).toEqual({ error: 'INVALID_PLAN' });
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-checkout-misconfigured' }),
		);
	});

	it('Stripe が session URL を返さないとき alert を上げる', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_env_std';
		mockSessionCreate.mockResolvedValue({ url: null });

		const result = await checkout();

		expect(result).toEqual({ error: 'INVALID_PLAN' });
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'stripe-checkout-misconfigured' }),
		);
	});

	it('alert payload に顧客識別子を載せない (#4174 Q3)', async () => {
		process.env.USE_LOOKUP_KEY = 'true';
		mockFindTenantById.mockResolvedValue(null);

		await checkout();

		for (const call of mockNotifyStripeAlert.mock.calls) {
			expect(JSON.stringify(call[0])).not.toContain('t-1');
		}
	});

	it('成功経路では alert を上げない (回帰防止)', async () => {
		process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_env_std';

		const result = await checkout();

		expect(result).toEqual({ url: 'https://checkout.stripe.com/s_1' });
		expect(mockNotifyStripeAlert).not.toHaveBeenCalled();
	});
});
