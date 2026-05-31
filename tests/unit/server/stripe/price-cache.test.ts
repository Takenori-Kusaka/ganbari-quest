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
