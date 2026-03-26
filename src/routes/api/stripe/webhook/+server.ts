// POST /api/stripe/webhook — Stripe Webhook エンドポイント
// セキュリティ: Stripe署名検証のみ（認証Cookie不要 — Stripeから直接呼ばれるため）
// 署名検証により、Stripe以外からのリクエストは全て拒否される

import { logger } from '$lib/server/logger';
import { handleWebhookEvent, verifyWebhookSignature } from '$lib/server/services/stripe-service';
import { error, json } from '@sveltejs/kit';
import type Stripe from 'stripe';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	// Stripe-Signature ヘッダーは Stripe が秘密鍵で生成
	// このヘッダーなしのリクエスト = 偽装 → 即拒否
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		error(400, 'Missing stripe-signature header');
	}

	// Raw body を取得（署名検証には加工前のボディが必要）
	const body = await request.text();

	// 署名検証: whsec_ シークレットで HMAC 検証
	// ソースコードを知っていても、whsec_ がなければ有効な署名は生成不可能
	let event: Stripe.Event;
	try {
		event = await verifyWebhookSignature(body, signature);
	} catch (err) {
		logger.warn(
			`[STRIPE-WEBHOOK] Signature verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
		);
		error(400, 'Invalid signature');
	}

	// Stripe のタイムスタンプ検証（SDK内蔵 — リプレイ攻撃防止、デフォルト300秒以内）
	// constructEvent() が自動で検証済み

	try {
		await handleWebhookEvent(event);
	} catch (err) {
		logger.error(
			`[STRIPE-WEBHOOK] Handler error for ${event.type}: ${err instanceof Error ? err.message : 'unknown'}`,
		);
		// Stripe にリトライさせるため 500 を返す
		error(500, 'Webhook handler failed');
	}

	// 200 を返すことで Stripe に受信成功を通知
	return json({ received: true });
};
