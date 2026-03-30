#!/usr/bin/env npx tsx
// scripts/stripe-setup-portal.ts
// Stripe Customer Portal 設定スクリプト (#0244 C2)
//
// 使用方法:
//   STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/stripe-setup-portal.ts
//
// 本番:
//   STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/stripe-setup-portal.ts

import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
	console.error('STRIPE_SECRET_KEY 環境変数を設定してください');
	process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: '2026-03-25.dahlia' });

async function setupPortal() {
	console.log('=== Stripe Customer Portal 設定 ===\n');

	// 既存の設定を確認
	const existingConfigs = await stripe.billingPortal.configurations.list({ limit: 5 });
	if (existingConfigs.data.length > 0) {
		console.log(`既存の設定が ${existingConfigs.data.length} 件あります。`);
		console.log('デフォルト設定を更新します...\n');

		const defaultConfig = existingConfigs.data.find((c) => c.is_default) ?? existingConfigs.data[0];
		const updated = await stripe.billingPortal.configurations.update(defaultConfig.id, {
			business_profile: {
				headline: 'がんばりクエスト アカウント管理',
				privacy_policy_url: 'https://www.ganbari-quest.com/privacy.html',
				terms_of_service_url: 'https://www.ganbari-quest.com/terms.html',
			},
			features: {
				customer_update: {
					enabled: true,
					allowed_updates: ['email', 'name'],
				},
				invoice_history: { enabled: true },
				payment_method_update: { enabled: true },
				subscription_cancel: {
					enabled: true,
					mode: 'at_period_end',
					cancellation_reason: {
						enabled: true,
						options: ['too_expensive', 'missing_features', 'unused', 'other'],
					},
				},
			},
			default_return_url: 'https://ganbari-quest.com/admin/license',
		});

		console.log(`設定を更新しました: ${updated.id}`);
		return;
	}

	// 新規作成
	const config = await stripe.billingPortal.configurations.create({
		business_profile: {
			headline: 'がんばりクエスト アカウント管理',
			privacy_policy_url: 'https://www.ganbari-quest.com/privacy.html',
			terms_of_service_url: 'https://www.ganbari-quest.com/terms.html',
		},
		features: {
			customer_update: {
				enabled: true,
				allowed_updates: ['email', 'name'],
			},
			invoice_history: { enabled: true },
			payment_method_update: { enabled: true },
			subscription_cancel: {
				enabled: true,
				mode: 'at_period_end',
				cancellation_reason: {
					enabled: true,
					options: ['too_expensive', 'missing_features', 'unused', 'other'],
				},
			},
		},
		default_return_url: 'https://ganbari-quest.com/admin/license',
	});

	console.log(`Customer Portal 設定を作成しました: ${config.id}`);
	console.log(`  ヘッドライン: ${config.business_profile.headline}`);
	console.log(`  デフォルト: ${config.is_default}`);
}

setupPortal().catch((err) => {
	console.error('エラー:', err.message);
	process.exit(1);
});
