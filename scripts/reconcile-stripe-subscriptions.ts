#!/usr/bin/env npx tsx
// scripts/reconcile-stripe-subscriptions.ts
// Stripe Subscription と DB テナントの整合性チェック (#741 / ADR-0022)
//
// 用途:
//   Stripe 側で active/trialing な Subscription をリストし、対応するテナントが
//   DB に存在するかを確認する。存在しない場合は「DB は消えたが Stripe は課金継続中」
//   の整合性違反。手動でキャンセルする必要がある。
//
// 使用方法:
//   STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/reconcile-stripe-subscriptions.ts
//
// 実行環境: 本番 DB にアクセスできる環境（NUC / Lambda コンテナ内）
//
// 注意: このスクリプトは検出のみを行う。自動修正はしない。
//   検出結果をもとに運用担当が Stripe ダッシュボードで手動キャンセルすること。

import Stripe from 'stripe';
import { getRepos } from '../src/lib/server/db/factory.js';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
	console.error('STRIPE_SECRET_KEY 環境変数を設定してください');
	process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: '2026-03-25.dahlia' });

interface ReconcileResult {
	totalStripeSubscriptions: number;
	orphanedSubscriptions: Array<{
		subscriptionId: string;
		customerId: string;
		tenantId: string | undefined;
		status: string;
		created: number;
	}>;
	matchedSubscriptions: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
async function reconcile(): Promise<ReconcileResult> {
	console.log('=== Stripe Subscription Reconciliation ===\n');

	const repos = getRepos();
	const result: ReconcileResult = {
		totalStripeSubscriptions: 0,
		orphanedSubscriptions: [],
		matchedSubscriptions: 0,
	};

	// Stripe から active/trialing な Subscription を全件取得（ページング対応）
	let hasMore = true;
	let startingAfter: string | undefined;

	while (hasMore) {
		const page = await stripe.subscriptions.list({
			limit: 100,
			status: 'all',
			starting_after: startingAfter,
		});

		for (const sub of page.data) {
			// canceled / incomplete_expired は確認不要
			if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue;

			result.totalStripeSubscriptions++;

			const tenantIdFromMetadata = sub.metadata?.tenantId;
			const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

			// メタデータ or Customer 経由でテナントを探す
			let tenant = tenantIdFromMetadata
				? await repos.auth.findTenantById(tenantIdFromMetadata)
				: undefined;
			if (!tenant && customerId) {
				tenant = await repos.auth.findTenantByStripeCustomerId(customerId);
			}

			if (!tenant) {
				result.orphanedSubscriptions.push({
					subscriptionId: sub.id,
					customerId: customerId ?? 'unknown',
					tenantId: tenantIdFromMetadata,
					status: sub.status,
					created: sub.created,
				});
			} else {
				result.matchedSubscriptions++;
			}
		}

		hasMore = page.has_more;
		startingAfter = page.data[page.data.length - 1]?.id;
	}

	return result;
}

async function main() {
	try {
		const result = await reconcile();

		console.log(`Stripe Subscription 総数: ${result.totalStripeSubscriptions}`);
		console.log(`DB と一致: ${result.matchedSubscriptions}`);
		console.log(`孤立 (DB テナントなし): ${result.orphanedSubscriptions.length}\n`);

		if (result.orphanedSubscriptions.length === 0) {
			console.log('✓ 整合性違反は検出されませんでした');
			process.exit(0);
		}

		console.error('⚠ 以下の Subscription はテナントが DB に存在しません。');
		console.error('  手動キャンセルが必要です:\n');

		for (const orphan of result.orphanedSubscriptions) {
			console.error(`  - subscription: ${orphan.subscriptionId}`);
			console.error(`    customer:     ${orphan.customerId}`);
			console.error(`    tenantId:     ${orphan.tenantId ?? '(メタデータなし)'}`);
			console.error(`    status:       ${orphan.status}`);
			console.error(`    created:      ${new Date(orphan.created * 1000).toISOString()}`);
			console.error('');
		}

		console.error('対処: Stripe ダッシュボードで手動キャンセル → 顧客に返金検討');
		process.exit(1);
	} catch (err) {
		console.error('スクリプト実行エラー:', err);
		process.exit(2);
	}
}

main();
