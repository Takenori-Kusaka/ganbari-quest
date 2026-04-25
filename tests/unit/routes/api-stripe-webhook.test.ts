// tests/unit/routes/api-stripe-webhook.test.ts
// #1497: Stripe Webhook ハンドラ単体テスト
//
// Node.js の crypto モジュールで HMAC-SHA256 署名を生成し、
// +server.ts の POST ハンドラが正しく処理するかを検証する。
//
// テストパターン:
// 1. customer.subscription.updated → 200
// 2. customer.subscription.deleted → 200
// 3. invoice.payment_failed → 200
// 4. 署名無効（改ざんボディ）→ 400
// 5. stripe-signature ヘッダーなし → 400

import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// テスト専用の Webhook シークレット（本番シークレットとは無関係）
const WEBHOOK_SECRET = 'whsec_test_for_unit_tests_only_1497';

// ---------- Mocks ----------

vi.mock('$lib/server/stripe/config', () => ({
	getWebhookSecret: () => WEBHOOK_SECRET,
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
		yearly: { priceId: 'price_yearly_456', amount: 5000, interval: 'year', label: '年額' },
	}),
	planIdFromPriceId: (priceId: string) => {
		if (priceId === 'price_monthly_123') return 'monthly';
		if (priceId === 'price_yearly_456') return 'yearly';
		return null;
	},
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

const mockHandleWebhookEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('$lib/server/services/stripe-service', async () => {
	// verifyWebhookSignature は Stripe の constructEvent を使った実装をインライン化する
	// （getStripeClient() のモックを避けるため直接 Stripe インスタンスを生成）
	const StripeImport = (await import('stripe')).default;
	const stripeVerify = new StripeImport('sk_test_dummy_for_verification_only', {
		apiVersion: '2026-04-22.dahlia',
	});
	return {
		handleWebhookEvent: (...args: unknown[]) => mockHandleWebhookEvent(...args),
		verifyWebhookSignature: async (body: string, signature: string) => {
			// constructEventAsync は非同期（SubtleCrypto ベース）で Node.js でも動作する
			return stripeVerify.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
		},
	};
});

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import { POST } from '../../../src/routes/api/stripe/webhook/+server';

// ---------- Helpers ----------

/**
 * Stripe Webhook 署名ヘッダー形式: `t=<timestamp>,v1=<hmac_hex>`
 * HMAC-SHA256(secret, `<timestamp>.<payload>`) で生成する。
 *
 * 参照: https://stripe.com/docs/webhooks/signatures
 */
function generateStripeSignature(payload: string, secret: string): string {
	const timestamp = Math.floor(Date.now() / 1000);
	const signedPayload = `${timestamp}.${payload}`;
	const hmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
	return `t=${timestamp},v1=${hmac}`;
}

/**
 * 正しい Stripe 署名付きリクエストを生成する。
 */
function makeSignedRequest(event: object): Request {
	const payload = JSON.stringify(event);
	const sig = generateStripeSignature(payload, WEBHOOK_SECRET);
	return new Request('http://localhost/api/stripe/webhook', {
		method: 'POST',
		headers: {
			'stripe-signature': sig,
			'content-type': 'application/json',
		},
		body: payload,
	});
}

/** リクエストコンテキスト（+server.ts の RequestHandler が受け取る形式）*/
function makeRequestEvent(request: Request) {
	return {
		request,
	} as Parameters<typeof POST>[0];
}

// ---------- Tests ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockHandleWebhookEvent.mockResolvedValue(undefined);
});

describe('POST /api/stripe/webhook (#1497)', () => {
	it('customer.subscription.updated → handleWebhookEvent が呼ばれ 200 を返す', async () => {
		const event = {
			id: 'evt_test_sub_updated',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_123',
					metadata: { tenantId: 't-test' },
					status: 'active',
					items: {
						data: [{ price: { id: 'price_monthly_123' } }],
					},
				},
			},
		};

		const request = makeSignedRequest(event);
		const response = await POST(makeRequestEvent(request));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({ received: true });
		expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(1);
	});

	it('customer.subscription.deleted → handleWebhookEvent が呼ばれ 200 を返す', async () => {
		const event = {
			id: 'evt_test_sub_deleted',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_123',
					metadata: { tenantId: 't-test' },
				},
			},
		};

		const request = makeSignedRequest(event);
		const response = await POST(makeRequestEvent(request));

		expect(response.status).toBe(200);
		expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(1);
	});

	it('invoice.payment_failed → handleWebhookEvent が呼ばれ 200 を返す', async () => {
		const event = {
			id: 'evt_test_inv_failed',
			type: 'invoice.payment_failed',
			data: {
				object: {
					parent: {
						subscription_details: { subscription: 'sub_123' },
					},
				},
			},
		};

		const request = makeSignedRequest(event);
		const response = await POST(makeRequestEvent(request));

		expect(response.status).toBe(200);
		expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(1);
	});

	it('署名無効（改ざんボディ）→ 400 を返す', async () => {
		// 正しい署名を生成してから、ボディだけ改ざんする
		const originalEvent = {
			id: 'evt_test_tampered',
			type: 'customer.subscription.updated',
			data: { object: {} },
		};
		const originalPayload = JSON.stringify(originalEvent);
		const sig = generateStripeSignature(originalPayload, WEBHOOK_SECRET);

		// ボディを改ざん（署名は元のペイロードに対して生成したもの）
		const tamperedPayload = JSON.stringify({ ...originalEvent, type: 'payment_intent.created' });
		const request = new Request('http://localhost/api/stripe/webhook', {
			method: 'POST',
			headers: {
				'stripe-signature': sig,
				'content-type': 'application/json',
			},
			body: tamperedPayload,
		});

		await expect(POST(makeRequestEvent(request))).rejects.toMatchObject({ status: 400 });
	});

	it('stripe-signature ヘッダーなし → 400 を返す', async () => {
		const event = {
			id: 'evt_test_no_sig',
			type: 'customer.subscription.updated',
			data: { object: {} },
		};

		const request = new Request('http://localhost/api/stripe/webhook', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				// stripe-signature ヘッダーなし
			},
			body: JSON.stringify(event),
		});

		await expect(POST(makeRequestEvent(request))).rejects.toMatchObject({ status: 400 });
	});
});
