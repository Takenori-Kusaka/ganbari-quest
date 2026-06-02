// src/lib/server/stripe/client.ts
// Stripe クライアント初期化（Lazy Singleton） (#0131)

import Stripe from 'stripe';

type StripeApiVersion = NonNullable<ConstructorParameters<typeof Stripe>[1]>['apiVersion'];

/**
 * Stripe API バージョン (Phase 7 PR-3b / Issue #2721、補強 PR #2684 docs SSOT 物理同期)
 *
 * **`'2026-04-22.dahlia'` を維持** (Stripe 最新 stable リリース)。
 * `'2026-05-27.dahlia'` は **preview リリース** (Stripe 公式 API versioning policy で
 * production 非推奨、backward incompatible change の評価専用) のため不採用。
 *
 * 副次制約 4 (Webhook destination api_version immutable、phase5-stripe-product-architecture
 * §4.4 / #2683) により、apiVersion bump は Webhook destination 新規作成 + 5 phase migration
 * (setup → discovery → shadow → cutover → retire) が強制必須。次回 stable リリース
 * (例: `'2026-06-XX.dahlia'`) 採用判断は別 PR で実施する。
 *
 * 設計 SSOT:
 *   - docs/decisions/0059-phase7-cutover-sequence.md
 *   - docs/design/billing-redesign/phase5-stripe-product-architecture.md §3.4 (#2683 訂正)
 *   - docs/design/billing-redesign/phase6-context-decisions-6.md §5.1 (5 phase migration 手順)
 *
 * Stripe 公式根拠:
 *   - https://docs.stripe.com/api/versioning (72h rollback window)
 */
const STRIPE_API_VERSION = '2026-04-22.dahlia' as StripeApiVersion;

let _client: Stripe | null = null;

/**
 * Stripe が有効かどうかを判定。
 * STRIPE_SECRET_KEY が設定されていなければ Stripe 無効（ローカル開発時など）。
 */
export function isStripeEnabled(): boolean {
	return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Stripe クライアントを取得（遅延初期化・シングルトン）。
 * 環境変数 STRIPE_SECRET_KEY が必須。
 */
export function getStripeClient(): Stripe {
	if (_client) return _client;

	const secretKey = process.env.STRIPE_SECRET_KEY;
	if (!secretKey) {
		throw new Error('STRIPE_SECRET_KEY must be set to use Stripe features');
	}

	_client = new Stripe(secretKey, {
		apiVersion: STRIPE_API_VERSION,
		typescript: true,
	});

	return _client;
}
