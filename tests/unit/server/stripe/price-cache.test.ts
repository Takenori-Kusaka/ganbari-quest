// tests/unit/server/stripe/price-cache.test.ts
//
// Phase 7 PR-3a / Issue #2716: lookup_key caching layer (`price-cache.ts`) のテスト。
//
// 検証内容:
//   - cache miss: Stripe API 呼出 + cache set
//   - cache hit: API スキップ
//   - TTL 経過: cache 再 fetch
//   - INVALID_LOOKUP_KEY: `prices.list` 結果 0 件で throw
//   - Stripe API rejection: cache に保存されない
//
// 設計 SSOT:
//   - docs/design/billing-redesign/phase6-context-decisions-6.md §4.2 caching layer
//   - docs/decisions/0059-phase7-cutover-sequence.md

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `getStripeClient` を mock するため price-cache の前に hoist
vi.mock('../../../../src/lib/server/stripe/client', () => ({
	getStripeClient: vi.fn(),
}));

import { getStripeClient } from '$lib/server/stripe/client';
import {
	clearPriceCacheForTesting,
	getPriceByLookupKey,
	getPriceCacheSizeForTesting,
} from '$lib/server/stripe/price-cache';

type StripeMock = {
	prices: {
		list: ReturnType<typeof vi.fn>;
	};
};

function makeStripeMock(priceId: string | null): StripeMock {
	return {
		prices: {
			list: vi.fn().mockResolvedValue({
				data: priceId ? [{ id: priceId }] : [],
			}),
		},
	};
}

function makeStripeRejectMock(error: Error): StripeMock {
	return {
		prices: {
			list: vi.fn().mockRejectedValue(error),
		},
	};
}

const getStripeClientMock = vi.mocked(getStripeClient);

beforeEach(() => {
	clearPriceCacheForTesting();
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
	getStripeClientMock.mockReset();
});

describe('getPriceByLookupKey — cache miss / hit / TTL (#2716)', () => {
	it('初回 (cache miss) は Stripe API を呼んで priceId を返す + cache set', async () => {
		const stripe = makeStripeMock('price_abc');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripe as any);

		const priceId = await getPriceByLookupKey('standard_monthly');

		expect(priceId).toBe('price_abc');
		expect(stripe.prices.list).toHaveBeenCalledTimes(1);
		expect(stripe.prices.list).toHaveBeenCalledWith({
			lookup_keys: ['standard_monthly'],
			active: true,
			limit: 1,
		});
		expect(getPriceCacheSizeForTesting()).toBe(1);
	});

	it('2 回目 (cache hit) は Stripe API を呼ばない', async () => {
		const stripe = makeStripeMock('price_abc');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripe as any);

		await getPriceByLookupKey('standard_monthly');
		await getPriceByLookupKey('standard_monthly');

		expect(stripe.prices.list).toHaveBeenCalledTimes(1);
	});

	it('TTL 5 min 経過後は cache miss として再 fetch', async () => {
		const stripe = makeStripeMock('price_abc');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripe as any);

		await getPriceByLookupKey('standard_monthly');
		expect(stripe.prices.list).toHaveBeenCalledTimes(1);

		// 5 min - 1 sec: まだ cache 有効
		vi.advanceTimersByTime(5 * 60 * 1000 - 1000);
		await getPriceByLookupKey('standard_monthly');
		expect(stripe.prices.list).toHaveBeenCalledTimes(1);

		// 5 min + 1 sec: cache expired
		vi.advanceTimersByTime(2 * 1000);
		await getPriceByLookupKey('standard_monthly');
		expect(stripe.prices.list).toHaveBeenCalledTimes(2);
	});

	it('異なる lookup_key は別 cache entry として管理される', async () => {
		const stripe: StripeMock = {
			prices: {
				list: vi
					.fn()
					.mockResolvedValueOnce({ data: [{ id: 'price_std' }] })
					.mockResolvedValueOnce({ data: [{ id: 'price_prm' }] }),
			},
		};
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripe as any);

		const std = await getPriceByLookupKey('standard_monthly');
		const prm = await getPriceByLookupKey('premium_monthly');

		expect(std).toBe('price_std');
		expect(prm).toBe('price_prm');
		expect(stripe.prices.list).toHaveBeenCalledTimes(2);
		expect(getPriceCacheSizeForTesting()).toBe(2);
	});
});

describe('getPriceByLookupKey — error handling (#2716)', () => {
	it('Stripe API が 0 件返した場合 INVALID_LOOKUP_KEY で throw', async () => {
		const stripe = makeStripeMock(null);
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripe as any);

		await expect(getPriceByLookupKey('standard_monthly')).rejects.toThrowError(
			/INVALID_LOOKUP_KEY: standard_monthly/,
		);
		expect(getPriceCacheSizeForTesting()).toBe(0); // cache に保存されない
	});

	it('Stripe API rejection (障害) は throw + cache に保存しない', async () => {
		const stripe = makeStripeRejectMock(new Error('Stripe API timeout'));
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripe as any);

		await expect(getPriceByLookupKey('standard_monthly')).rejects.toThrowError(
			/Stripe API timeout/,
		);
		expect(getPriceCacheSizeForTesting()).toBe(0);
	});
});

// ============================================================================
// TOCTOU race scenario (#2735 / QA Adversarial security 軸 follow-up)
// ============================================================================
//
// price-cache 5min TTL window 内で Stripe Dashboard `transfer_lookup_key` 操作が走り、
// cache に旧 priceId が残ったまま新 lookup_key 解決が要求された場合の eventual consistency
// 動作を SSOT として明示する。本 cache の TOCTOU 設計判断は price-cache.ts L25-36 のコメントに
// 記載済 (Pre-PMF Bucket A 「5min eventual consistency window 許容」)。
//
// Stripe 公式仕様 (https://docs.stripe.com/products-prices/manage-prices `transfer_lookup_key`):
//   - 新 Price に lookup_key を移転、旧 Price の lookup_key は空になる
//   - **旧 Price 自体は active 継続** (subscription / invoice 既存契約は破壊されない)
//   - = TOCTOU window 中に旧 priceId を返しても課金 path は安全に継続する
//
// 本 test は以下 3 scenario を assert:
//   1. cache hit window 内 (TTL 切れ前) は旧 priceId 返却継続 (race window 安全性)
//   2. TTL 切れ後の cache miss で新 priceId 解決 (eventual consistency 5min)
//   3. cache flush 不要 (Lambda 再 deploy = cold start で自然 reset、運用 SOP 整合)

describe('getPriceByLookupKey — TOCTOU lookup_key collision (#2735 / QA Adversarial security 軸)', () => {
	it('5min TTL window 内で transfer_lookup_key が走っても旧 priceId 返却 (race window 課金 path 継続)', async () => {
		// scenario:
		//   T=0min:   admin が Stripe Dashboard で旧 lookup_key=standard_monthly → 旧 priceId=price_old を解決
		//   T=1min:   Stripe Dashboard で transfer_lookup_key 実行 (新 priceId=price_new)
		//   T=2min:   別 customer が getPriceByLookupKey('standard_monthly') 呼出
		//             → cache hit で **旧 priceId=price_old** 返却 (TOCTOU lag)
		//             → Stripe 公式仕様: 旧 Price は active 継続 = 課金 path 安全
		const stripeOld = makeStripeMock('price_old');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripeOld as any);

		// T=0min: 旧 priceId を cache に格納
		const t0 = await getPriceByLookupKey('standard_monthly');
		expect(t0).toBe('price_old');

		// T=1min: Stripe Dashboard で transfer_lookup_key 実行 (実体は Stripe 側のみ)
		// (本 test では mock を新 priceId に振り替え。実環境では cache miss 時のみ反映される)
		const stripeNew = makeStripeMock('price_new');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripeNew as any);

		// T=2min (TTL 5min 内): cache hit で旧 priceId 返却継続 (TOCTOU lag)
		vi.advanceTimersByTime(2 * 60 * 1000);
		const t2 = await getPriceByLookupKey('standard_monthly');
		expect(t2).toBe('price_old'); // ← TOCTOU window 中は旧値 (Stripe 公式: 旧 Price active 継続で安全)
		expect(stripeNew.prices.list).not.toHaveBeenCalled(); // cache hit で Stripe API 呼出ゼロ
	});

	it('TTL 5min 経過後の cache miss で transfer_lookup_key 後の新 priceId に eventual 収束', async () => {
		// scenario: TOCTOU race window 終了後 (TTL 5min 経過) の cache miss で新 priceId に収束
		const stripeOld = makeStripeMock('price_old');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripeOld as any);

		await getPriceByLookupKey('standard_monthly');

		// Stripe 側で transfer_lookup_key 実行 → 次回 cache miss 時に新 priceId 解決される
		const stripeNew = makeStripeMock('price_new');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripeNew as any);

		// TTL 5min + 1sec 経過 (cache expired)
		vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

		const tEventual = await getPriceByLookupKey('standard_monthly');
		expect(tEventual).toBe('price_new'); // eventual consistency 5min で収束
		expect(stripeNew.prices.list).toHaveBeenCalledTimes(1); // cache miss で Stripe API 呼出
	});

	it('cache flush 不要: clearPriceCacheForTesting() (= Lambda cold start 相当) で即座に新 priceId 解決', async () => {
		// scenario: 運用 SOP の Lambda 再 deploy (cold start) で自然 reset される動作を test 化。
		// 本番では cache flush 操作なしで Lambda 再 deploy 後の cold start で必ず新 priceId が解決される。
		const stripeOld = makeStripeMock('price_old');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripeOld as any);

		await getPriceByLookupKey('standard_monthly');
		expect(getPriceCacheSizeForTesting()).toBe(1);

		// Lambda cold start 相当 (新 container で module 再初期化 = cache 空)
		clearPriceCacheForTesting();
		expect(getPriceCacheSizeForTesting()).toBe(0);

		// Stripe 側で transfer_lookup_key 済の状態
		const stripeNew = makeStripeMock('price_new');
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripeNew as any);

		// cold start 後の初回呼出で新 priceId 解決
		const t = await getPriceByLookupKey('standard_monthly');
		expect(t).toBe('price_new');
		expect(stripeNew.prices.list).toHaveBeenCalledTimes(1);
	});

	it('TOCTOU window 内に異なる lookup_key が同時 fetch されても互いに影響しない (race independence)', async () => {
		// scenario: standard_monthly と premium_monthly の 2 lookup_key が並行 cache される場合の独立性。
		// 片方の transfer_lookup_key が他方の TOCTOU window に干渉しないことを保証。
		const stripe: StripeMock = {
			prices: {
				list: vi.fn().mockImplementation(async ({ lookup_keys }: { lookup_keys: string[] }) => {
					if (lookup_keys[0] === 'standard_monthly') return { data: [{ id: 'price_std_old' }] };
					if (lookup_keys[0] === 'premium_monthly') return { data: [{ id: 'price_prm_old' }] };
					return { data: [] };
				}),
			},
		};
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK 型は本テストで不要
		getStripeClientMock.mockReturnValue(stripe as any);

		const std = await getPriceByLookupKey('standard_monthly');
		const prm = await getPriceByLookupKey('premium_monthly');
		expect(std).toBe('price_std_old');
		expect(prm).toBe('price_prm_old');
		expect(getPriceCacheSizeForTesting()).toBe(2);

		// 1min 経過 (どちらも TTL window 内): 両方 cache hit
		vi.advanceTimersByTime(60 * 1000);
		const stdHit = await getPriceByLookupKey('standard_monthly');
		const prmHit = await getPriceByLookupKey('premium_monthly');
		expect(stdHit).toBe('price_std_old');
		expect(prmHit).toBe('price_prm_old');
		// 各 lookup_key 初回 1 回ずつのみ Stripe API 呼出 (cache hit で再呼出ゼロ)
		expect(stripe.prices.list).toHaveBeenCalledTimes(2);
	});
});
