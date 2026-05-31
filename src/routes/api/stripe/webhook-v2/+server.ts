// POST /api/stripe/webhook-v2 — Stripe Webhook 新 endpoint (Phase 7 PR-4a / Issue #2713)
//
// Stripe 公式 5 phase migration (setup → discovery → shadow → cutover → retire) の
// shadow phase (Step 4-a) で 24-48h log only 検証する新 endpoint。
//
// 動作モード:
//   - `STRIPE_WEBHOOK_SHADOW_MODE=true` (shadow phase, Step 4-a): signature 検証 + log 記録 +
//     DB write せず + HTTP 200 返却。dedup 用 event.id は将来 PR-4b cutover で活用する。
//   - `STRIPE_WEBHOOK_SHADOW_MODE=false` (default, cutover 後): 既存 handler に dispatch
//     して本番処理。本 PR (PR-4a) では shadow mode のみが想定経路で、cutover (PR-4b)
//     マージ後に本ブランチが本流になる。
//
// セキュリティ:
//   - Stripe-Signature ヘッダー必須 (HMAC-SHA256 検証、cookie 認証不要)
//   - 署名検証用 secret は `STRIPE_WEBHOOK_SECRET_TEST` 優先、未設定なら `STRIPE_WEBHOOK_SECRET`
//   - 署名検証失敗時は 400 で即拒否 (リプレイ攻撃防止は SDK 内蔵 timestamp 検証)
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md
//   - docs/design/billing-redesign/phase6-phase7-execution-ssot.md §3 Step 4-a
//   - docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md
//
// 本番影響: default `STRIPE_WEBHOOK_SHADOW_MODE=false` で env 配備のみ。Stripe Dashboard で
// 新 destination を有効化しない限り event は到達せず、production 動作は不変。

import { error, json } from '@sveltejs/kit';
import type Stripe from 'stripe';
import { logger } from '$lib/server/logger';
import { handleWebhookEvent, verifyWebhookSignature } from '$lib/server/services/stripe-service';
import { getStripeClient } from '$lib/server/stripe/client';
import { getWebhookSecretForShadow, isWebhookShadowModeEnabled } from '$lib/server/stripe/config';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		error(400, 'Missing stripe-signature header');
	}

	const body = await request.text();
	const shadowMode = isWebhookShadowModeEnabled();

	// shadow mode: shadow 用 secret で構築 (constructEventAsync = SubtleCrypto-based、Node 互換)
	// cutover 後: 既存 verifyWebhookSignature 経由で本番 secret 検証
	let event: Stripe.Event;
	try {
		if (shadowMode) {
			const stripe = getStripeClient();
			event = await stripe.webhooks.constructEventAsync(
				body,
				signature,
				getWebhookSecretForShadow(),
			);
		} else {
			event = await verifyWebhookSignature(body, signature);
		}
	} catch (err) {
		logger.warn(
			`[STRIPE-WEBHOOK-V2] Signature verification failed (shadow=${shadowMode}): ${err instanceof Error ? err.message : 'unknown'}`,
		);
		error(400, 'Invalid signature');
	}

	if (shadowMode) {
		// Shadow phase: DB write せず log のみ。dedup 観測用に event.id / type を記録。
		// 24-48h 観測で silent drop = 0 件を確認した後、PR-4b cutover で `false` 切替。
		logger.info(
			`[STRIPE-WEBHOOK-V2][SHADOW] received event.id=${event.id} type=${event.type} apiVersion=${event.api_version ?? 'unknown'}`,
		);
		return json({ received: true, mode: 'shadow' });
	}

	// Cutover 後 (PR-4b 以降): 既存 handler に dispatch。
	try {
		await handleWebhookEvent(event);
	} catch (err) {
		logger.error(
			`[STRIPE-WEBHOOK-V2] Handler error for ${event.type}: ${err instanceof Error ? err.message : 'unknown'}`,
		);
		error(500, 'Webhook handler failed');
	}

	return json({ received: true, mode: 'cutover' });
};
