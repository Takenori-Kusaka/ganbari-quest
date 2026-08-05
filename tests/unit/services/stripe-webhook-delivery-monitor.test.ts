// tests/unit/services/stripe-webhook-delivery-monitor.test.ts
// #3959: Stripe webhook 未達 (沈黙) の検知。
//
// 守る不変条件:
//   [D1] 2026-07-26 と同型 (Stripe 側で滞留 + 支払い済みなのに plan 未反映) で必ず 1 通鳴る
//   [D2] 正常時は鳴らない (毎時 cron が false positive を出さない)
//   [D3] handler 失敗の疑い (滞留はあるが plan は反映済) では鳴らない
//        = PR #4079 `stripe-webhook-handler-failed` と二重に鳴らないための責務分界
//   [D4] 閾値未満 (STALE_MINUTES 以内) の event は検査対象に入れない
//   [D5] Stripe 無効環境 (staging / NUC / local) では検査も通知もしない
//   [D6] 1 回の実行で送る通知は 1 通だけ
//   [D7] 通知に顧客の個人情報を載せない

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();
const mockFindWebhookEventById = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { findTenantById: mockFindTenantById },
		webhookEvent: { findByEventId: mockFindWebhookEventById },
	}),
}));

const mockIsStripeEnabled = vi.fn();
const mockEventsList = vi.fn();

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => mockIsStripeEnabled(),
	getStripeClient: () => ({ events: { list: mockEventsList } }),
}));

const mockNotifyStripeAlert = vi.fn();
vi.mock('$lib/server/stripe/alert', () => ({
	// cron は alert 送信が最終処理になるため await 可能な版を使う (#4102 M2)
	notifyStripeAlertAsync: (...args: unknown[]) => {
		mockNotifyStripeAlert(...args);
		return Promise.resolve();
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { checkWebhookDelivery, STALE_MINUTES } = await import(
	'../../../src/lib/server/services/stripe-webhook-delivery-monitor'
);

const NOW = new Date('2026-07-30T12:00:00.000Z');

/** NOW から `minutesAgo` 分前に作られた event の unix 秒 */
function createdAt(minutesAgo: number): number {
	return Math.floor(NOW.getTime() / 1000) - minutesAgo * 60;
}

function checkoutEvent(opts: {
	id?: string;
	minutesAgo?: number;
	pendingWebhooks?: number;
	tenantId?: string | null;
	/** この checkout が成立させた subscription id (Stripe 側の事実) */
	subscriptionId?: string;
	/** Stripe が返す payload に混ざる顧客情報 (通知に載ってはならない) */
	customerEmail?: string;
}) {
	return {
		id: opts.id ?? 'evt_checkout_1',
		type: 'checkout.session.completed',
		created: createdAt(opts.minutesAgo ?? 60),
		pending_webhooks: opts.pendingWebhooks ?? 1,
		data: {
			object: {
				metadata: opts.tenantId === null ? {} : { tenantId: opts.tenantId ?? 'tenant-1' },
				subscription: opts.subscriptionId ?? 'sub_123',
				customer_email: opts.customerEmail ?? 'parent@example.com',
			},
		},
	};
}

function invoiceEvent(opts: { id?: string; minutesAgo?: number; pendingWebhooks?: number }) {
	return {
		id: opts.id ?? 'evt_invoice_1',
		type: 'invoice.paid',
		created: createdAt(opts.minutesAgo ?? 60),
		pending_webhooks: opts.pendingWebhooks ?? 1,
		data: { object: {} },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockEventsList.mockResolvedValue({ data: [] });
	mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: 'sub_123' });
	// 既定は「台帳に載っている」= 受信〜記録まで到達した状態 (#4128 AC6)。
	// 台帳欠落 (S3) を検査する test だけが個別に null を返す。
	mockFindWebhookEventById.mockResolvedValue({ eventId: 'evt_x', handlerResult: 'success' });
});

describe('#3959 [D1] 未達 (2026-07-26 と同型) を検知して通知する', () => {
	it('滞留 event があり checkout の plan 反映も無いとき、alert が 1 回発火する', async () => {
		mockEventsList.mockResolvedValue({
			data: [checkoutEvent({ pendingWebhooks: 1, minutesAgo: 60 })],
		});
		// plan が反映されていない = subscription が結び付いていない
		mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: null });

		const result = await checkWebhookDelivery(NOW);

		expect(result.alerted).toBe(true);
		expect(result.staleEvents).toHaveLength(1);
		expect(result.unreflectedCheckouts).toHaveLength(1);
		expect(mockNotifyStripeAlert).toHaveBeenCalledTimes(1);
		expect(mockNotifyStripeAlert.mock.calls[0]?.[0]).toMatchObject({
			kind: 'stripe-webhook-undelivered',
		});
	});

	it('checkout の metadata に tenantId が無い場合も未反映として扱う (判定不能を沈黙させない)', async () => {
		mockEventsList.mockResolvedValue({ data: [checkoutEvent({ tenantId: null })] });

		const result = await checkWebhookDelivery(NOW);

		expect(result.unreflectedCheckouts[0]?.reason).toBe('tenant-id-missing');
		expect(result.alerted).toBe(true);
	});

	it('既存契約者のプラン変更 checkout が反映されていない場合も検知する', async () => {
		// tenant は「変更前の」subscription を持ったまま。subscription の有無だけを見ると
		// 「反映済み」と誤判定され、代金だけ取られて機能が開かない状態を見逃す。
		mockEventsList.mockResolvedValue({ data: [checkoutEvent({ subscriptionId: 'sub_new' })] });
		mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: 'sub_old' });

		const result = await checkWebhookDelivery(NOW);

		expect(result.unreflectedCheckouts[0]?.reason).toBe('subscription-mismatch');
		expect(result.alerted).toBe(true);
	});

	it('tenant が見つからない場合も未反映として扱う', async () => {
		mockEventsList.mockResolvedValue({ data: [checkoutEvent({})] });
		mockFindTenantById.mockResolvedValue(undefined);

		const result = await checkWebhookDelivery(NOW);

		expect(result.unreflectedCheckouts[0]?.reason).toBe('tenant-not-found');
		expect(result.alerted).toBe(true);
	});
});

describe('#3959 [D2] 正常時は鳴らない', () => {
	it('全 event が配信済み (pending_webhooks=0) なら alert しない', async () => {
		mockEventsList.mockResolvedValue({
			data: [checkoutEvent({ pendingWebhooks: 0 }), invoiceEvent({ pendingWebhooks: 0 })],
		});

		const result = await checkWebhookDelivery(NOW);

		expect(result.staleEvents).toHaveLength(0);
		expect(result.alerted).toBe(false);
		expect(mockNotifyStripeAlert).not.toHaveBeenCalled();
	});

	it('対象 event が 1 件も無ければ alert しない', async () => {
		mockEventsList.mockResolvedValue({ data: [] });

		const result = await checkWebhookDelivery(NOW);

		expect(result.checked).toBe(0);
		expect(result.alerted).toBe(false);
		expect(mockNotifyStripeAlert).not.toHaveBeenCalled();
	});
});

describe('#3959 [D3] PR #4079 (stripe-webhook-handler-failed) と二重に鳴らない', () => {
	it('滞留はあるが plan は反映済 (handler 失敗の疑い) なら本 alert は沈黙する', async () => {
		// handler が throw して 500 を返し続けると Stripe 側の pending は残る。
		// この事象は初回失敗の時点で `stripe-webhook-handler-failed` が所有するため、
		// 本 cron は鳴らしてはならない。
		mockEventsList.mockResolvedValue({
			data: [checkoutEvent({ pendingWebhooks: 1 }), invoiceEvent({ pendingWebhooks: 2 })],
		});
		mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: 'sub_123' });

		const result = await checkWebhookDelivery(NOW);

		expect(result.staleEvents.length).toBeGreaterThan(0);
		expect(result.unreflectedCheckouts).toHaveLength(0);
		expect(result.alerted).toBe(false);
		expect(mockNotifyStripeAlert).not.toHaveBeenCalled();
	});

	it('plan 未反映でも Stripe 側が配信済みなら鳴らない (別経路で反映される途中の可能性)', async () => {
		mockEventsList.mockResolvedValue({ data: [checkoutEvent({ pendingWebhooks: 0 })] });
		mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: null });

		const result = await checkWebhookDelivery(NOW);

		expect(result.staleEvents).toHaveLength(0);
		expect(result.alerted).toBe(false);
	});
});

describe('#3959 [D4] 滞留閾値', () => {
	it(`Stripe への問い合わせ窓の上端が ${STALE_MINUTES} 分前になっている (直近の event を拾わない)`, async () => {
		await checkWebhookDelivery(NOW);

		const params = mockEventsList.mock.calls[0]?.[0] as {
			created: { gte: number; lte: number };
			types: string[];
			limit: number;
		};
		const nowSec = Math.floor(NOW.getTime() / 1000);
		expect(params.created.lte).toBe(nowSec - STALE_MINUTES * 60);
		expect(params.created.gte).toBeLessThan(params.created.lte);
		expect(params.types).toContain('checkout.session.completed');
		expect(params.limit).toBeGreaterThan(0);
	});
});

describe('#3959 [D5] Stripe 無効環境では何もしない', () => {
	it('isStripeEnabled=false なら Stripe API を叩かず alert もしない', async () => {
		mockIsStripeEnabled.mockReturnValue(false);

		const result = await checkWebhookDelivery(NOW);

		expect(result.skipped).toBe('stripe-disabled');
		expect(mockEventsList).not.toHaveBeenCalled();
		expect(mockNotifyStripeAlert).not.toHaveBeenCalled();
	});
});

describe('#3959 [D6] 1 実行 1 通', () => {
	it('未達 event が複数あっても通知は 1 通にまとめる', async () => {
		mockEventsList.mockResolvedValue({
			data: [
				checkoutEvent({ id: 'evt_a' }),
				checkoutEvent({ id: 'evt_b' }),
				invoiceEvent({ id: 'evt_c' }),
			],
		});
		mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: null });

		const result = await checkWebhookDelivery(NOW);

		expect(result.staleEvents).toHaveLength(3);
		expect(result.unreflectedCheckouts).toHaveLength(2);
		expect(mockNotifyStripeAlert).toHaveBeenCalledTimes(1);
	});
});

describe('#3959 [D8] oldestEventId は最古の滞留 event を指す (#4102 M4)', () => {
	it('Stripe が新しい順で返しても、alert には最古の event が載る', async () => {
		// stripe.events.list は created 降順で返す。先頭をそのまま採ると「最新」が
		// oldestEventId として通知され、runbook の「最古から辿って障害開始時刻を推定する」
		// triage が誤った時刻を指す。
		mockEventsList.mockResolvedValue({
			data: [
				checkoutEvent({ id: 'evt_newest', minutesAgo: 40 }),
				checkoutEvent({ id: 'evt_middle', minutesAgo: 120 }),
				checkoutEvent({ id: 'evt_oldest', minutesAgo: 600 }),
			],
		});
		mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: null });

		await checkWebhookDelivery(NOW);

		const tags = (mockNotifyStripeAlert.mock.calls[0]?.[0] as { tags: Record<string, unknown> })
			.tags;
		expect(tags.oldestEventId).toBe('evt_oldest');
		expect(tags.oldestCreatedIso).toBe(new Date(createdAt(600) * 1000).toISOString());
	});
});

describe('#3959 [D7] 通知に個人情報を載せない', () => {
	it('alert の message / tags に customer_email が現れない', async () => {
		mockEventsList.mockResolvedValue({
			data: [checkoutEvent({ customerEmail: 'secret-parent@example.com' })],
		});
		mockFindTenantById.mockResolvedValue({ id: 'tenant-1', stripeSubscriptionId: null });

		await checkWebhookDelivery(NOW);

		const payload = JSON.stringify(mockNotifyStripeAlert.mock.calls[0]?.[0]);
		expect(payload).not.toContain('secret-parent@example.com');
		expect(payload).not.toContain('@');
	});
});

// ---------------------------------------------------------------------------
// #4128 AC6 [D9] Stripe 側 event 数と台帳 event 数の乖離 (S3)
// ---------------------------------------------------------------------------
//
// S1 ∧ S2 は「Stripe 側が未完了 (pending>0)」を前提にしているため、**200 を返して event を
// 捨てた**ケース (shadow mode / 受信口の取り違え / dispatch 漏れ) を構造的に検知できない。
// Stripe から見れば配信成功 (pending=0) であり、こちらの台帳にだけ何も残らない。
//
// 「Stripe には event があるのに台帳に無い」を独立 signal (S3) として持つことで、経路 1/2 が
// 将来別の形で再発しても落ちたこと自体には気づける。

describe('#4128 [D9] 受信〜台帳記録の到達率 (Stripe 側 event 数 vs 台帳 event 数)', () => {
	it('Stripe が配信成功 (pending=0) なのに台帳に無い event を検知して alert する', async () => {
		mockEventsList.mockResolvedValue({
			data: [invoiceEvent({ id: 'evt_dropped_1', pendingWebhooks: 0, minutesAgo: 60 })],
		});
		mockFindWebhookEventById.mockResolvedValue(null); // 台帳に無い = 受け取って捨てた

		const result = await checkWebhookDelivery(NOW);

		expect(result.ledgerMissing).toEqual([
			expect.objectContaining({ eventId: 'evt_dropped_1', eventType: 'invoice.paid' }),
		]);
		expect(result.alerted).toBe(true);
		expect(mockNotifyStripeAlert.mock.calls[0]?.[0]).toMatchObject({
			kind: 'stripe-webhook-ledger-gap',
		});
	});

	it('台帳に載っている event は乖離として数えない (空振り検出)', async () => {
		mockEventsList.mockResolvedValue({
			data: [invoiceEvent({ id: 'evt_ok_1', pendingWebhooks: 0, minutesAgo: 60 })],
		});

		const result = await checkWebhookDelivery(NOW);

		expect(result.ledgerMissing).toEqual([]);
		expect(result.alerted).toBe(false);
	});

	it('Stripe 側がまだ配信できていない (pending>0) event は乖離に数えない', async () => {
		// pending>0 は「到達していない / 500 を返した」であり S1 の担当。台帳に無いのは当然なので
		// S3 で二重に鳴らさない (#4079 との責務分界と同じ考え方)。
		mockEventsList.mockResolvedValue({
			data: [invoiceEvent({ id: 'evt_pending_1', pendingWebhooks: 1, minutesAgo: 60 })],
		});
		mockFindWebhookEventById.mockResolvedValue(null);

		const result = await checkWebhookDelivery(NOW);

		expect(result.ledgerMissing).toEqual([]);
	});

	it('乖離が複数あっても通知は 1 通にまとめる', async () => {
		mockEventsList.mockResolvedValue({
			data: [
				invoiceEvent({ id: 'evt_dropped_1', pendingWebhooks: 0, minutesAgo: 60 }),
				invoiceEvent({ id: 'evt_dropped_2', pendingWebhooks: 0, minutesAgo: 90 }),
			],
		});
		mockFindWebhookEventById.mockResolvedValue(null);

		await checkWebhookDelivery(NOW);

		expect(mockNotifyStripeAlert).toHaveBeenCalledTimes(1);
	});

	it('Stripe 無効環境では台帳照会も行わない', async () => {
		mockIsStripeEnabled.mockReturnValue(false);

		const result = await checkWebhookDelivery(NOW);

		expect(result.skipped).toBe('stripe-disabled');
		expect(mockFindWebhookEventById).not.toHaveBeenCalled();
	});
});
