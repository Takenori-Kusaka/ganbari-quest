// src/lib/server/stripe/price-cache.ts
//
// Phase 7 PR-3a / Issue #2716: Stripe lookup_key 経由 Price ID 解決の caching layer
// (Stripe 公式 `transfer_lookup_key` パターン 4 step の Step 1)
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md §「結果」§1 (Step 3 lookup_key 移行)
//   - docs/design/billing-redesign/phase6-context-decisions-6.md §4.2 caching layer 設計
//   - docs/design/billing-redesign/phase5-stripe-product-architecture.md §3.4 (2 Product 各 1 Price + lookup_key)
//
// Stripe 公式根拠:
//   - https://docs.stripe.com/products-prices/manage-prices (`transfer_lookup_key`)
//   - https://docs.stripe.com/api/prices/list (`lookup_keys` parameter)
//
// 設計原則:
//   - Step 1 (本 PR): caching layer 実装。`USE_LOOKUP_KEY=false` (default) で未経路
//   - Step 2-3 (PR-3b): cutover で env var 直読 → lookup_key 経路に切替
//   - Step 4 (Step 5 / PR-5): 旧 Price archive + env var (`STRIPE_PRICE_*` 4 件) 削除
//
// TTL 5 min 根拠 (context-decisions-6 §4.2):
//   Stripe Dashboard で Price 更新が反映される最大遅延 (Stripe 公式 SLA 暗黙的) +
//   Lambda cold start 影響最小化のバランス。`transfer_lookup_key` で lookup_key 移行時は
//   cache flush 不要 (新 priceId が次回解決で取得される)。
//
// TOCTOU 検討 (#2720 Adversarial security 軸):
//   cache 5 min window 内に Stripe Dashboard で `transfer_lookup_key` を実行した場合、
//   1. cache hit で旧 priceId を返す (TOCTOU = time-of-check vs time-of-use 乖離) が、
//   2. `transfer_lookup_key` は **新 Price を新 lookup_key にひもづけ、旧 Price の lookup_key
//      を空にする** Stripe 公式仕様 (https://docs.stripe.com/products-prices/manage-prices)
//      = 旧 Price 自体は active のまま (subscription / invoice 既存契約は破壊されない)
//   3. 次回 TTL 切れ後の Stripe API 呼出で新 priceId が cache に格納される (eventual consistency)
//   4. Pre-PMF Bucket A (ADR-0010) として「5 min eventual consistency window」を許容
//      (Stripe migration は計画的に実施され、運用 SOP で `clearPriceCacheForTesting`
//      経由 cache flush は不要、Lambda 再 deploy = cold start で自然 reset)。
//   5. 観測強化: config.ts `getPriceId()` の fallback 経路で `notifyStripeAlert` 起動済
//      (#2720)、cache TTL window 中の異常を Discord alert で検出可能。

import { getStripeClient } from './client';

/**
 * 本 PR で対応する lookup_key 一覧 (2 Product 各 1 Price 構成、補強 PR #2684 整合)
 *
 * 将来追加 (PR-3b 以降):
 *   - `standard_yearly` / `premium_yearly` (yearly plan 統合時)
 */
export type LookupKey = 'standard_monthly' | 'premium_monthly';

/** in-memory cache entry */
interface CacheEntry {
	priceId: string;
	expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min (context-decisions-6 §4.2 整合)

/**
 * module-level singleton cache。Lambda 実行コンテキスト (warm container) 内で再利用される。
 *
 * NOTE: テストでは `clearPriceCacheForTesting()` で reset する。本番 / dev コードから呼ばない。
 */
const priceCache = new Map<LookupKey, CacheEntry>();

/**
 * lookup_key 経由で Stripe Price ID を解決する (caching layer)。
 *
 * Stripe API `prices.list({ lookup_keys, active: true, limit: 1 })` で 1 件取得し、
 * 結果を TTL 5 min で in-memory cache する。次回呼出時 cache hit なら API スキップ。
 *
 * @param lookupKey - Stripe Price の lookup_key (`standard_monthly` / `premium_monthly`)
 * @returns 解決された Price ID (例: `price_1Abc...`)
 * @throws Stripe API 障害時 (`prices.list` rejection) / lookup_key に対応する Price が無い場合
 *
 * 設計 SSOT: docs/design/billing-redesign/phase6-context-decisions-6.md §4.2
 *
 * @example
 *   const priceId = await getPriceByLookupKey('standard_monthly');
 *   // → 'price_1Abc...' (Stripe Dashboard で発行された Price ID)
 */
export async function getPriceByLookupKey(lookupKey: LookupKey): Promise<string> {
	const cached = priceCache.get(lookupKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.priceId;
	}

	const stripe = getStripeClient();
	const result = await stripe.prices.list({
		lookup_keys: [lookupKey],
		active: true,
		limit: 1,
	});

	const firstPrice = result.data[0];
	if (!firstPrice) {
		throw new Error(
			`INVALID_LOOKUP_KEY: ${lookupKey} (Stripe Dashboard で active な Price が見つからない)`,
		);
	}

	const priceId = firstPrice.id;
	priceCache.set(lookupKey, {
		priceId,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
	return priceId;
}

/**
 * テスト専用: cache を clear する。production / dev コードから呼ばない。
 *
 * NOTE: TTL は 5 min と長いため、テスト間で cache が leak すると意図しない hit が発生する。
 * 各テストの `beforeEach` で呼ぶことを推奨。
 */
export function clearPriceCacheForTesting(): void {
	priceCache.clear();
}

/**
 * テスト専用: cache size 取得 (TTL 動作検証用)。
 */
export function getPriceCacheSizeForTesting(): number {
	return priceCache.size;
}
