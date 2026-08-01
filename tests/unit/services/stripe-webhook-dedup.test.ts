// tests/unit/services/stripe-webhook-dedup.test.ts
//
// #3985: Stripe webhook の event.id dedup 回帰テスト。
//
// Stripe の at-least-once delivery では同一 `event.id` の再到達が正規動作
// (<https://docs.stripe.com/webhooks#handle-duplicate-events>)。dedup が配線されていないと
// welcome メール 2 通 / past_due ↔ active の振動 / 解約 → 再活性化の振動が素通しになる。
//
// 本 spec は **購読 5 種すべての handler** について「同一 event.id が 2 回到達しても
// 副作用が 1 回だけ」を assert する (設計 SSOT:
// docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §2 / §4.1 / §4.3)。
//
// dedup 台帳は demo (in-memory) 実装を **実物のまま** 使う。「dedup したことにする mock」で
// 通るテストにしないため (repo 契約ごと検証する)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	_resetDemoWebhookEvents,
	demoWebhookEventRepo,
} from '../../../src/lib/server/db/demo/webhook-event-repo';

// ---------- Mocks ----------

const mockFindTenantById = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockFindTenantByStripeCustomerId = vi.fn();

vi.mock('$lib/server/db/factory', async () => {
	const { demoWebhookEventRepo: repo } = await import(
		'../../../src/lib/server/db/demo/webhook-event-repo'
	);
	return {
		getRepos: () => ({
			auth: {
				findTenantById: mockFindTenantById,
				updateTenantStripe: mockUpdateTenantStripe,
				findTenantByStripeCustomerId: mockFindTenantByStripeCustomerId,
			},
			webhookEvent: repo,
		}),
	};
});

const mockGetStripeClient = vi.fn();

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
	getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
	}),
	planIdFromPriceId: (priceId: string) => (priceId === 'price_monthly_123' ? 'monthly' : null),
	planIdFromLookupKey: () => null,
	getWebhookSecret: () => 'whsec_test',
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

const mockNotifyStripeAlert = vi.fn();
vi.mock('$lib/server/stripe/alert', () => ({
	notifyStripeAlert: (...args: unknown[]) => mockNotifyStripeAlert(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockNotifyBillingEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: (...args: unknown[]) => mockNotifyBillingEvent(...args),
}));

// ---------- Import after mocks ----------

import {
	handleWebhookEvent,
	WEBHOOK_CLAIM_STALE_MINUTES,
} from '../../../src/lib/server/services/stripe-service';

// ---------- Fixtures ----------

function makeTenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: 't-test',
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: 'sub_123',
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

/** 購読 5 種すべての event fixture (設計書 §4.3 の handler 一覧と 1:1)。 */
const WEBHOOK_EVENTS = [
	{
		label: 'checkout.session.completed',
		event: {
			id: 'evt_checkout_1',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test',
					metadata: { tenantId: 't-test', planId: 'monthly' },
					customer: 'cus_new',
					subscription: 'sub_new',
					customer_details: { email: 'test@example.com' },
					customer_email: null,
				},
			},
		},
	},
	{
		label: 'invoice.paid',
		event: {
			id: 'evt_invoice_paid_1',
			type: 'invoice.paid',
			data: {
				object: {
					parent: { subscription_details: { subscription: 'sub_123' } },
					lines: {
						data: [{ amount: 500, pricing: { price_details: { price: 'price_monthly_123' } } }],
					},
				},
			},
		},
	},
	{
		label: 'invoice.payment_failed',
		event: {
			id: 'evt_invoice_failed_1',
			type: 'invoice.payment_failed',
			data: { object: { parent: { subscription_details: { subscription: 'sub_123' } } } },
		},
	},
	{
		label: 'customer.subscription.updated',
		event: {
			id: 'evt_sub_updated_1',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_123',
					metadata: { tenantId: 't-test' },
					status: 'active',
					items: { data: [{ price: { id: 'price_monthly_123', lookup_key: null } }] },
				},
			},
		},
	},
	{
		label: 'customer.subscription.deleted',
		event: {
			id: 'evt_sub_deleted_1',
			type: 'customer.subscription.deleted',
			data: { object: { id: 'sub_123', metadata: { tenantId: 't-test' } } },
		},
	},
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	_resetDemoWebhookEvents();
	mockFindTenantById.mockResolvedValue(makeTenant());
	mockFindTenantByStripeCustomerId.mockResolvedValue(makeTenant());
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockNotifyBillingEvent.mockResolvedValue(undefined);
	mockGetStripeClient.mockReturnValue({
		subscriptions: {
			retrieve: vi.fn().mockResolvedValue({
				id: 'sub_123',
				customer: 'cus_123',
				status: 'active',
				metadata: {},
				items: { data: [{ price: { id: 'price_monthly_123', lookup_key: null } }] },
			}),
		},
	});
});

describe('handleWebhookEvent — event.id dedup (#3985)', () => {
	describe.each(WEBHOOK_EVENTS)('$label', ({ event }) => {
		it('初回到達では handler が実行され、契約状態が 1 回書かれる', async () => {
			await handleWebhookEvent(event as never);
			expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		});

		it('同一 event.id が 2 回到達しても副作用は 1 回だけ', async () => {
			await handleWebhookEvent(event as never);
			await handleWebhookEvent(event as never);

			// 2 回目は handler ごと skip されるため、DB 書き込みは増えない
			expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		});

		it('重複到達は throw せず正常終了する (呼び出し元が 200 を返せる)', async () => {
			await handleWebhookEvent(event as never);
			// 4xx / 5xx を返すと Stripe の retry を誘発し重複到達がさらに増える (設計書 §2)
			await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
		});

		it('処理済み event は台帳に 1 行だけ残り、再到達で retryCount が増える', async () => {
			await handleWebhookEvent(event as never);
			const first = await demoWebhookEventRepo.findByEventId(event.id);
			expect(first).toMatchObject({
				eventId: event.id,
				eventType: event.type,
				handlerResult: 'success',
				retryCount: 0,
			});

			await handleWebhookEvent(event as never);
			expect((await demoWebhookEventRepo.findByEventId(event.id))?.retryCount).toBe(1);

			await handleWebhookEvent(event as never);
			expect((await demoWebhookEventRepo.findByEventId(event.id))?.retryCount).toBe(2);
		});
	});

	it('別の event.id は dedup されず、それぞれ処理される (dedup の空振り検出)', async () => {
		// 「常に skip する」実装でも上の 5 件は通ってしまうため、対照を置く
		for (const { event } of WEBHOOK_EVENTS) {
			await handleWebhookEvent(event as never);
		}
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(WEBHOOK_EVENTS.length);
	});

	it('welcome 通知も 1 回だけ (checkout 重複で 2 通送らない)', async () => {
		const checkout = WEBHOOK_EVENTS[0].event;
		await handleWebhookEvent(checkout as never);
		await handleWebhookEvent(checkout as never);

		expect(mockNotifyBillingEvent).toHaveBeenCalledTimes(1);
	});

	it('未購読の event 型も台帳に記録され、再到達では dispatch されない', async () => {
		const event = { id: 'evt_unhandled_1', type: 'payment_intent.created', data: { object: {} } };

		await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
		expect(await demoWebhookEventRepo.findByEventId('evt_unhandled_1')).toMatchObject({
			handlerResult: 'skipped',
			retryCount: 0,
		});

		await handleWebhookEvent(event as never);
		expect((await demoWebhookEventRepo.findByEventId('evt_unhandled_1'))?.retryCount).toBe(1);
	});

	it('handler が失敗した event は台帳に残らず、再送で再処理される (Stripe retry を潰さない)', async () => {
		// 設計書 §4.2 の選択肢 A (失敗も記録して 200) を採らない根拠の回帰。
		// 記録してしまうと一過性障害で event を恒久的に失う。
		const event = WEBHOOK_EVENTS[4].event; // customer.subscription.deleted
		mockUpdateTenantStripe.mockRejectedValueOnce(new Error('DB 一時障害'));

		await expect(handleWebhookEvent(event as never)).rejects.toThrow('DB 一時障害');
		expect(await demoWebhookEventRepo.findByEventId(event.id)).toBeNull();

		// Stripe が同一 event.id で再送 → 今度は成功し、台帳に記録される
		await handleWebhookEvent(event as never);
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(2);
		expect(await demoWebhookEventRepo.findByEventId(event.id)).toMatchObject({
			handlerResult: 'success',
		});
	});

	it('handler 失敗は初回から Discord alert に上がる (再送が尽きる前に人が気づける)', async () => {
		// 台帳に残さず Stripe の再送に載せる (§4.2) 判断は、再送が 3 日で尽きる前に
		// 人が気づけることとセットでのみ成立する。log だけで終わらせない回帰。
		const event = WEBHOOK_EVENTS[0].event; // checkout.session.completed
		mockUpdateTenantStripe.mockRejectedValueOnce(new Error('DB 一時障害'));

		await expect(handleWebhookEvent(event as never)).rejects.toThrow('DB 一時障害');

		expect(mockNotifyStripeAlert).toHaveBeenCalledTimes(1);
		expect(mockNotifyStripeAlert).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'stripe-webhook-handler-failed',
				// throttle key は event.id 単位 (別 event の失敗を巻き込んで無音化しない)
				errorSummary: `webhook-handler-failed:${event.id}`,
				tags: expect.objectContaining({
					eventId: event.id,
					eventType: event.type,
					error: 'DB 一時障害',
				}),
			}),
		);
	});

	it('handler 成功時は failure alert を出さない', async () => {
		await handleWebhookEvent(WEBHOOK_EVENTS[0].event as never);
		expect(
			mockNotifyStripeAlert.mock.calls.filter(
				(call) => (call[0] as { kind: string }).kind === 'stripe-webhook-handler-failed',
			),
		).toHaveLength(0);
	});

	it('checkout の dedup row には analytics 用の tenantId が入る (PII は入れない)', async () => {
		await handleWebhookEvent(WEBHOOK_EVENTS[0].event as never);
		const record = await demoWebhookEventRepo.findByEventId('evt_checkout_1');
		expect(record?.tenantId).toBe('t-test');
		expect(record?.errorMessage).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// #4128: dedup を insert-first 化する (find → handler → insert の非原子構成を塞ぐ)
// ---------------------------------------------------------------------------
//
// 旧構成は `findByEventId` → handler → `insert` の 3 段で、find と insert の間に await 境界が
// ある。同一 event.id が短時間に 2 通到達する (Stripe の再送とオリジナルの競合 / Lambda 同時起動)
// と両方が find を通過し handler が二重実行される。しかも insert は `ON CONFLICT DO NOTHING`
// なので**痕跡が残らない**。処理権を先に取る (insert-first) ことで DB の原子性に寄せる。

describe('handleWebhookEvent — 並列到達の処理権 (#4128 AC3 / AC4)', () => {
	it('同一 event.id が並列到達しても handler は 1 回しか走らない', async () => {
		const event = WEBHOOK_EVENTS[3].event; // customer.subscription.updated

		// await を挟まず同時に起動する = 2 つの Lambda が同じ event を掴んだ状態
		const results = await Promise.allSettled([
			handleWebhookEvent(event as never),
			handleWebhookEvent(event as never),
		]);

		expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
	});

	it('並列到達した checkout の welcome 通知も 1 回だけ', async () => {
		const checkout = WEBHOOK_EVENTS[0].event;

		await Promise.allSettled([
			handleWebhookEvent(checkout as never),
			handleWebhookEvent(checkout as never),
		]);

		expect(mockNotifyBillingEvent).toHaveBeenCalledTimes(1);
	});

	it('処理権を取れなかった側は throw せず正常終了する (呼び出し元が 200 を返せる)', async () => {
		const event = WEBHOOK_EVENTS[4].event; // customer.subscription.deleted

		const results = await Promise.allSettled([
			handleWebhookEvent(event as never),
			handleWebhookEvent(event as never),
		]);

		// 4xx / 5xx を返すと Stripe の retry を誘発し重複到達がさらに増える (設計書 §2)
		expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
	});

	it('handler 失敗時は処理権が解放され、台帳に未処理 row が残らない', async () => {
		// insert-first にすると「掴んだが処理していない row」が生まれうる。それが残ると
		// 次回到達で dedup され、event が恒久的に失われる (旧構成には無かった失敗モード)。
		const event = WEBHOOK_EVENTS[4].event;
		mockUpdateTenantStripe.mockRejectedValueOnce(new Error('DB 一時障害'));

		await expect(handleWebhookEvent(event as never)).rejects.toThrow('DB 一時障害');
		expect(await demoWebhookEventRepo.findByEventId(event.id)).toBeNull();
	});

	it('処理中に落ちた処理権 (Lambda crash) は一定時間後に再処理できる', async () => {
		// 解放処理そのものが落ちた場合 (Lambda kill / DB 断) に備えた最後の逃げ道。
		// これが無いと insert-first は「一度掴んで死んだ event を永久に捨てる」機構になる。
		const event = WEBHOOK_EVENTS[3].event;
		const staleIso = new Date(
			Date.now() - (WEBHOOK_CLAIM_STALE_MINUTES + 1) * 60_000,
		).toISOString();

		await demoWebhookEventRepo.claim(
			{
				eventId: event.id,
				eventType: event.type,
				processedAt: staleIso,
				handlerResult: 'processing',
				errorMessage: null,
				retryCount: 0,
				tenantId: null,
			},
			staleIso,
		);

		await handleWebhookEvent(event as never);

		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		expect(await demoWebhookEventRepo.findByEventId(event.id)).toMatchObject({
			handlerResult: 'success',
		});
	});

	it('処理中の処理権はまだ新しいうちは奪われない (二重実行に戻さない)', async () => {
		const event = WEBHOOK_EVENTS[3].event;
		const freshIso = new Date().toISOString();

		await demoWebhookEventRepo.claim(
			{
				eventId: event.id,
				eventType: event.type,
				processedAt: freshIso,
				handlerResult: 'processing',
				errorMessage: null,
				retryCount: 0,
				tenantId: null,
			},
			new Date(Date.now() - WEBHOOK_CLAIM_STALE_MINUTES * 60_000).toISOString(),
		);

		await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});
});
