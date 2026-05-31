// tests/unit/routes/api-stripe-webhook-v2.test.ts
//
// Phase 7 PR-4a / Issue #2713: Webhook shadow mode endpoint の単体テスト。
//
// `/api/stripe/webhook-v2/+server.ts` が以下 2 つの動作モードで正しく分岐するか:
//   - shadow mode (`STRIPE_WEBHOOK_SHADOW_MODE=true`):
//       signature 検証 + log 記録 + DB write せず + HTTP 200 + body.mode='shadow'
//   - cutover mode (default):
//       既存 `handleWebhookEvent` に dispatch + HTTP 200 + body.mode='cutover'
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md
//   - docs/design/billing-redesign/phase6-phase7-execution-ssot.md §3 Step 4-a
//
// 既存 `tests/unit/routes/api-stripe-webhook.test.ts` (#1497) と同じ HMAC 生成パターン
// を踏襲し、`handleWebhookEvent` は spy で観測する。

import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const WEBHOOK_SECRET = 'whsec_test_webhook_v2_unit';
const WEBHOOK_SECRET_TEST = 'whsec_test_v2_shadow_secret';

// ---------- Mocks ----------

vi.mock('$lib/server/stripe/config', () => ({
	getWebhookSecret: () => WEBHOOK_SECRET,
	getWebhookSecretForShadow: () => WEBHOOK_SECRET_TEST,
	isWebhookShadowModeEnabled: vi.fn(() => false),
	getPlans: () => ({}),
	planIdFromPriceId: () => null,
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/stripe/client', async () => {
	const StripeImport = (await import('stripe')).default;
	const stripeVerify = new StripeImport('sk_test_dummy_for_v2_unit', {
		apiVersion: '2026-04-22.dahlia',
	});
	return { getStripeClient: () => stripeVerify, isStripeEnabled: () => true };
});

const mockHandleWebhookEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('$lib/server/services/stripe-service', async () => {
	const StripeImport = (await import('stripe')).default;
	const stripeVerify = new StripeImport('sk_test_dummy_for_v2_service', {
		apiVersion: '2026-04-22.dahlia',
	});
	return {
		handleWebhookEvent: (...args: unknown[]) => mockHandleWebhookEvent(...args),
		verifyWebhookSignature: async (body: string, signature: string) =>
			stripeVerify.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET),
	};
});

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import { logger } from '$lib/server/logger';
import { isWebhookShadowModeEnabled } from '$lib/server/stripe/config';
import { POST } from '../../../src/routes/api/stripe/webhook-v2/+server';

// ---------- Helpers ----------

function generateStripeSignature(payload: string, secret: string): string {
	const timestamp = Math.floor(Date.now() / 1000);
	const signedPayload = `${timestamp}.${payload}`;
	const hmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
	return `t=${timestamp},v1=${hmac}`;
}

function makeSignedRequest(event: object, secret: string): Request {
	const payload = JSON.stringify(event);
	const sig = generateStripeSignature(payload, secret);
	return new Request('http://localhost/api/stripe/webhook-v2', {
		method: 'POST',
		headers: {
			'stripe-signature': sig,
			'content-type': 'application/json',
		},
		body: payload,
	});
}

function makeRequestEvent(request: Request) {
	return { request } as Parameters<typeof POST>[0];
}

const sampleEvent = {
	id: 'evt_v2_shadow_test',
	type: 'customer.subscription.updated',
	api_version: '2026-04-22.dahlia',
	data: {
		object: {
			id: 'sub_v2_test',
			metadata: { tenantId: 't-v2' },
			status: 'active',
			items: { data: [{ price: { id: 'price_v2' } }] },
		},
	},
};

// ---------- Tests ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockHandleWebhookEvent.mockResolvedValue(undefined);
	vi.mocked(isWebhookShadowModeEnabled).mockReturnValue(false);
});

describe('POST /api/stripe/webhook-v2 (#2713 Phase 7 PR-4a)', () => {
	describe('shadow mode (STRIPE_WEBHOOK_SHADOW_MODE=true)', () => {
		beforeEach(() => {
			vi.mocked(isWebhookShadowModeEnabled).mockReturnValue(true);
		});

		it('shadow secret で署名された event を 200 + mode=shadow で受理', async () => {
			const request = makeSignedRequest(sampleEvent, WEBHOOK_SECRET_TEST);
			const response = await POST(makeRequestEvent(request));

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ received: true, mode: 'shadow' });
		});

		it('shadow mode では handleWebhookEvent を呼ばない (DB write なし)', async () => {
			const request = makeSignedRequest(sampleEvent, WEBHOOK_SECRET_TEST);
			await POST(makeRequestEvent(request));

			expect(mockHandleWebhookEvent).not.toHaveBeenCalled();
		});

		it('shadow mode では event.id / event.type を log に記録する', async () => {
			const request = makeSignedRequest(sampleEvent, WEBHOOK_SECRET_TEST);
			await POST(makeRequestEvent(request));

			expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
				expect.stringContaining('[STRIPE-WEBHOOK-V2][SHADOW]'),
			);
			expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
				expect.stringContaining(`event.id=${sampleEvent.id}`),
			);
			expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
				expect.stringContaining(`type=${sampleEvent.type}`),
			);
		});

		it('shadow mode で本番 secret で署名された event は 400 (shadow secret 不一致)', async () => {
			const request = makeSignedRequest(sampleEvent, WEBHOOK_SECRET);
			await expect(POST(makeRequestEvent(request))).rejects.toMatchObject({ status: 400 });
			expect(mockHandleWebhookEvent).not.toHaveBeenCalled();
		});
	});

	describe('cutover mode (default, STRIPE_WEBHOOK_SHADOW_MODE=false)', () => {
		it('本番 secret で署名された event を handleWebhookEvent に dispatch + 200 + mode=cutover', async () => {
			const request = makeSignedRequest(sampleEvent, WEBHOOK_SECRET);
			const response = await POST(makeRequestEvent(request));

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ received: true, mode: 'cutover' });
			expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(1);
		});

		it('handler が throw した場合 500 を返す (Stripe retry 発動)', async () => {
			mockHandleWebhookEvent.mockRejectedValueOnce(new Error('handler boom'));

			const request = makeSignedRequest(sampleEvent, WEBHOOK_SECRET);
			await expect(POST(makeRequestEvent(request))).rejects.toMatchObject({ status: 500 });
		});
	});

	describe('セキュリティ (mode 共通)', () => {
		it('stripe-signature ヘッダーなし → 400', async () => {
			const request = new Request('http://localhost/api/stripe/webhook-v2', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(sampleEvent),
			});
			await expect(POST(makeRequestEvent(request))).rejects.toMatchObject({ status: 400 });
		});

		it('改ざんボディ → 400 (cutover mode)', async () => {
			const original = JSON.stringify(sampleEvent);
			const sig = generateStripeSignature(original, WEBHOOK_SECRET);
			const tampered = JSON.stringify({ ...sampleEvent, type: 'tampered.event' });

			const request = new Request('http://localhost/api/stripe/webhook-v2', {
				method: 'POST',
				headers: {
					'stripe-signature': sig,
					'content-type': 'application/json',
				},
				body: tampered,
			});
			await expect(POST(makeRequestEvent(request))).rejects.toMatchObject({ status: 400 });
		});
	});
});
