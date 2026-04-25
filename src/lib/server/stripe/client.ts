// src/lib/server/stripe/client.ts
// Stripe クライアント初期化（Lazy Singleton） (#0131)

import Stripe from 'stripe';

type StripeApiVersion = NonNullable<ConstructorParameters<typeof Stripe>[1]>['apiVersion'];

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
