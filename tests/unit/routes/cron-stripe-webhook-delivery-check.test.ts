// tests/unit/routes/cron-stripe-webhook-delivery-check.test.ts
//
// #3959 / #4102 (QM 指摘 M3): 未達検知 cron endpoint の「検知器自体が死んだ」経路。
//
// 守る不変条件:
//   [E1] 検知が throw したとき alert が飛ぶ (検知器の停止が誰にも届かない状態を作らない)
//   [E2] alert 送信はレスポンス返却前に完了する (Lambda freeze で通知が消えない)
//   [E3] alert に例外の生 message を載せない (DSQL の接続情報 / token 断片の外部流出を防ぐ)
//   [E4] 正常時は alert を出さない (毎時 cron が Discord を汚さない)
//
// 背景: cron-dispatcher (infra/lambda/cron-dispatcher/index.ts) は非 2xx を throw せず
// `{ statusCode: 500 }` を return するため、endpoint が 500 を返しても Lambda invocation は
// 成功扱いになり `cron-dispatcher-errors` alarm は鳴らない。500 を返すだけでは無言のままになる。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		critical: vi.fn(),
	},
}));

const checkWebhookDeliveryMock = vi.fn();
vi.mock('$lib/server/services/stripe-webhook-delivery-monitor', () => ({
	checkWebhookDelivery: (...args: unknown[]) => checkWebhookDeliveryMock(...args),
}));

const notifyStripeAlertAsyncMock = vi.fn();
vi.mock('$lib/server/stripe/alert', () => ({
	notifyStripeAlertAsync: (...args: unknown[]) => notifyStripeAlertAsyncMock(...args),
}));

const originalEnv = { ...process.env };
const SECRET = 'test-cron-secret-4102';
const ENDPOINT = 'http://localhost/api/cron/stripe-webhook-delivery-check';

function authedRequest(): Request {
	return new Request(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
		body: JSON.stringify({}),
	});
}

async function postEndpoint() {
	const { POST } = await import(
		'../../../src/routes/api/cron/stripe-webhook-delivery-check/+server'
	);
	return POST({ request: authedRequest() } as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv };
	process.env.CRON_SECRET = SECRET;
	notifyStripeAlertAsyncMock.mockResolvedValue(undefined);
});

afterEach(() => {
	process.env = originalEnv;
});

describe('#4102 [E1][E3] 検知器自体の失敗を鳴らす', () => {
	it('checkWebhookDelivery が throw すると alert が 1 通飛び、500 を返す', async () => {
		checkWebhookDeliveryMock.mockRejectedValue(new Error('Stripe API 500 rate_limit'));

		const res = await postEndpoint();

		expect(res.status).toBe(500);
		expect(notifyStripeAlertAsyncMock).toHaveBeenCalledTimes(1);
		expect(notifyStripeAlertAsyncMock.mock.calls[0]?.[0]).toMatchObject({
			kind: 'stripe-webhook-monitor-failed',
		});
	});

	it('alert に例外の生 message を載せない (接続情報の外部流出経路を作らない)', async () => {
		checkWebhookDeliveryMock.mockRejectedValue(
			new Error('connection to host=db.internal user=admin password=hunter2 failed'),
		);

		await postEndpoint();

		const payload = JSON.stringify(notifyStripeAlertAsyncMock.mock.calls[0]?.[0]);
		expect(payload).not.toContain('hunter2');
		expect(payload).not.toContain('db.internal');
		// 例外クラス名までは載せる (どの層で落ちたかの当たりを付けるため)
		expect(payload).toContain('Error');
	});
});

describe('#4102 [E2] alert 送信はレスポンス前に完了する', () => {
	it('alert の送信が終わるまで endpoint はレスポンスを返さない', async () => {
		checkWebhookDeliveryMock.mockRejectedValue(new Error('DSQL unavailable'));

		let delivered = false;
		let releaseSend: () => void = () => {};
		const sendGate = new Promise<void>((resolve) => {
			releaseSend = resolve;
		});
		notifyStripeAlertAsyncMock.mockImplementation(async () => {
			await sendGate;
			delivered = true;
		});

		let responded = false;
		const pending = postEndpoint().then((res) => {
			responded = true;
			return res;
		});

		// 送信を止めたまま event loop を回す。await していない実装ならここで応答が確定し、
		// 実機では直後の Lambda freeze で送信中の fetch が消える
		for (let i = 0; i < 5; i++) {
			await new Promise((resolve) => setImmediate(resolve));
		}
		expect(responded).toBe(false);
		expect(delivered).toBe(false);

		releaseSend();
		const res = await pending;

		expect(delivered).toBe(true);
		expect(res.status).toBe(500);
	});
});

describe('#4102 [E4] 正常時は鳴らさない', () => {
	it('検知が正常終了したら alert を出さず 200 を返す', async () => {
		checkWebhookDeliveryMock.mockResolvedValue({
			skipped: null,
			checked: 3,
			staleEvents: [],
			unreflectedCheckouts: [],
			truncated: false,
			alerted: false,
		});

		const res = await postEndpoint();

		expect(res.status).toBe(200);
		expect(notifyStripeAlertAsyncMock).not.toHaveBeenCalled();
	});
});
