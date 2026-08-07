// tests/unit/routes/cron-grace-period-deletion.test.ts
// #4327: 物理削除 cron endpoint の観測性テスト。
//
// 部分失敗 (tenantsFailed > 0) が HTTP 200 に埋もれると、cron-dispatcher は 2xx を成功として
// 扱うためどの alarm にも乗らず、「途中まで消えたテナント」が誰にも観測されないまま残る
// (#4327 product-2 / security-2)。endpoint が 500 を返すことで
//   - dispatcher の httpPost が非 2xx を reject → Lambda invocation error
//   - → 既存の `ganbari-quest-cron-dispatcher-errors` alarm が発火する
// という既存経路に載る。あわせて Discord の incident webhook にも直接出す。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CRON_TRIGGER_HEADER,
	CRON_TRIGGER_SCHEDULED,
} from '../../../src/lib/server/cron/cron-trigger';

vi.mock('$lib/server/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

const purgeMock = vi.fn();
vi.mock('$lib/server/services/grace-period-service', () => ({
	GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM: '[grace-period-deletion] partial failure',
	purgeExpiredSoftDeletedTenants: (...args: unknown[]) => purgeMock(...args),
}));

type AlertPayload = { level: string; message: string; details?: string };
const sendDiscordAlertMock = vi.fn(async (_payload: AlertPayload) => {});
vi.mock('$lib/server/discord-alert', () => ({
	sendDiscordAlert: (payload: AlertPayload) => sendDiscordAlertMock(payload),
}));

const ENDPOINT = 'http://localhost/api/cron/grace-period-deletion';
const SECRET = 'test-cron-secret-4327';
const originalEnv = { ...process.env };

function authedRequest(extraHeaders: Record<string, string> = {}): Request {
	return new Request(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET, ...extraHeaders },
		body: JSON.stringify({}),
	});
}

async function postEndpoint(extraHeaders: Record<string, string> = {}) {
	const { POST } = await import('../../../src/routes/api/cron/grace-period-deletion/+server');
	return POST({ request: authedRequest(extraHeaders) } as unknown as Parameters<typeof POST>[0]);
}

function purgeResult(over: Partial<Record<string, unknown>> = {}) {
	return {
		tenantsProcessed: 0,
		tenantsDeleted: 0,
		tenantsFailed: 0,
		tenantsRemaining: 0,
		dryRun: false,
		disabled: false,
		expired: [],
		errors: [],
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv };
	process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
	process.env = originalEnv;
});

describe('#4327 grace-period-deletion endpoint の部分失敗の観測性', () => {
	it('部分失敗 (tenantsFailed > 0) は 200 ではなく 500 を返す', async () => {
		purgeMock.mockResolvedValue(
			purgeResult({
				tenantsProcessed: 2,
				tenantsDeleted: 1,
				tenantsFailed: 1,
				errors: [{ tenantId: 't-fail', error: 'boom' }],
			}),
		);

		const res = await postEndpoint();

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.ok).toBe(false);
		// 何が起きたかは body に残す (500 にするだけで情報を落とさない)
		expect(body.tenantsFailed).toBe(1);
		expect(body.errors).toEqual([{ tenantId: 't-fail', error: 'boom' }]);
	});

	it('部分失敗は既存の Discord incident 経路にも出す (顧客識別子は載せない)', async () => {
		purgeMock.mockResolvedValue(
			purgeResult({
				tenantsProcessed: 3,
				tenantsDeleted: 2,
				tenantsFailed: 1,
				errors: [{ tenantId: 't-fail', error: 'boom' }],
			}),
		);

		await postEndpoint();

		expect(sendDiscordAlertMock).toHaveBeenCalledTimes(1);
		const payload = sendDiscordAlertMock.mock.calls[0]?.[0];
		expect(payload?.level).toBe('critical');
		// 件数は届く (triage に必要な「毎回変わる情報」)
		expect(payload?.details).toContain('失敗 1 件');
		// tenantId が payload に載っていないこと (discord-alert.ts の設計制約)
		expect(JSON.stringify(payload)).not.toContain('t-fail');
	});

	it('全件成功なら従来どおり 200 を返し、alert も出さない (回帰)', async () => {
		purgeMock.mockResolvedValue(
			purgeResult({ tenantsProcessed: 2, tenantsDeleted: 2, tenantsFailed: 0 }),
		);

		const res = await postEndpoint();

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ ok: true, tenantsDeleted: 2 });
		expect(sendDiscordAlertMock).not.toHaveBeenCalled();
	});

	it('kill-switch で無効化されている場合も 200 (失敗ではない)', async () => {
		purgeMock.mockResolvedValue(purgeResult({ disabled: true }));

		const res = await postEndpoint();

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ ok: true, disabled: true });
		expect(sendDiscordAlertMock).not.toHaveBeenCalled();
	});
});

describe('#4338 削除経路の判定 (定時実行 / 人の手)', () => {
	beforeEach(() => {
		purgeMock.mockResolvedValue(purgeResult());
	});

	it('スケジューラの marker がある呼び出しは grace-expiry として記録する', async () => {
		await postEndpoint({ [CRON_TRIGGER_HEADER]: CRON_TRIGGER_SCHEDULED });

		expect(purgeMock).toHaveBeenCalledWith(expect.objectContaining({ route: 'grace-expiry' }));
	});

	it('marker が無い呼び出し (運用者が手で叩いた) は manual として記録する', async () => {
		await postEndpoint();

		expect(purgeMock).toHaveBeenCalledWith(expect.objectContaining({ route: 'manual' }));
	});

	it('marker の値が違えば manual (既定は手動側 — 送り忘れを定時実行と誤記録しない)', async () => {
		await postEndpoint({ [CRON_TRIGGER_HEADER]: 'something-else' });

		expect(purgeMock).toHaveBeenCalledWith(expect.objectContaining({ route: 'manual' }));
	});

	it('認証ヘッダの種類では判定しない (Bearer でも marker が無ければ manual)', async () => {
		// verifyCronAuth は x-cron-secret / Authorization: Bearer を同等に受理するため、
		// 認証ヘッダから人と機械を区別することはできない。
		const { POST } = await import('../../../src/routes/api/cron/grace-period-deletion/+server');
		const request = new Request(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
			body: JSON.stringify({}),
		});
		await POST({ request } as unknown as Parameters<typeof POST>[0]);

		expect(purgeMock).toHaveBeenCalledWith(expect.objectContaining({ route: 'manual' }));
	});
});
