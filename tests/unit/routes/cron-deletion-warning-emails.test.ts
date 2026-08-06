// tests/unit/routes/cron-deletion-warning-emails.test.ts
// #2399: 削除予告メール cron endpoint の認証分岐。
//
// 守る不変条件 (verifyCronAuth の 3 パターンを endpoint 経由で固定する):
//   [A1] CRON_SECRET 設定済 + ヘッダなし / 不一致 → 401 (無認証で外部公開されない)
//   [A2] CRON_SECRET 設定済 + Authorization: Bearer / x-cron-secret 一致 → 200
//        (AWS cron-dispatcher は Bearer、NUC scheduler は x-cron-secret。両方通ること)
//   [A3] CRON_SECRET / OPS_SECRET_KEY 未設定 → AUTH_MODE=local なら通す / それ以外は 500
//        (本番の設定漏れを 401 で誤魔化さず 500 で表面化させる)
//   [A4] service が throw しても内部例外を response に出さない (ADR-0062 §2)

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

const runDeletionWarningEmailsMock = vi.fn();
vi.mock('$lib/server/services/deletion-warning-service', () => ({
	runDeletionWarningEmails: (...args: unknown[]) => runDeletionWarningEmailsMock(...args),
}));

const originalEnv = { ...process.env };
const SECRET = 'test-cron-secret-2399';
const ENDPOINT = 'http://localhost/api/cron/deletion-warning-emails';

function request(headers: Record<string, string> = {}, body: unknown = {}): Request {
	return new Request(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}

async function post(req: Request) {
	const { POST } = await import('../../../src/routes/api/cron/deletion-warning-emails/+server');
	return POST({ request: req } as unknown as Parameters<typeof POST>[0]);
}

async function get(req: Request) {
	const { GET } = await import('../../../src/routes/api/cron/deletion-warning-emails/+server');
	return GET({ request: req } as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv };
	process.env.CRON_SECRET = SECRET;
	runDeletionWarningEmailsMock.mockResolvedValue({
		scanned: 0,
		sent: 0,
		skippedNotSoftDeleted: 0,
		skippedNoThreshold: 0,
		skippedNotDue: 0,
		skippedAlreadySent: 0,
		skippedNoRecipients: 0,
		errors: 0,
		tenantsRemaining: 0,
		dryRun: false,
	});
});

afterEach(() => {
	process.env = originalEnv;
});

describe('#2399 [A1] CRON_SECRET 設定済 — 不正リクエストは 401', () => {
	it('認証ヘッダなしの POST は 401 (service を呼ばない)', async () => {
		const res = await post(request());
		expect(res.status).toBe(401);
		expect(runDeletionWarningEmailsMock).not.toHaveBeenCalled();
	});

	it('不一致の x-cron-secret は 401', async () => {
		const res = await post(request({ 'x-cron-secret': 'wrong' }));
		expect(res.status).toBe(401);
		expect(runDeletionWarningEmailsMock).not.toHaveBeenCalled();
	});

	it('認証ヘッダなしの GET (ヘルスチェック) も 401', async () => {
		const res = await get(new Request(ENDPOINT));
		expect(res.status).toBe(401);
	});
});

describe('#2399 [A2] CRON_SECRET 設定済 — 正しい認証は 200', () => {
	it('Authorization: Bearer で 200 (AWS cron-dispatcher 経路)', async () => {
		const res = await post(request({ Authorization: `Bearer ${SECRET}` }));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true });
	});

	it('x-cron-secret で 200 (NUC scheduler 経路)', async () => {
		const res = await post(request({ 'x-cron-secret': SECRET }));
		expect(res.status).toBe(200);
	});

	it('dryRun=true を service に渡す', async () => {
		await post(request({ 'x-cron-secret': SECRET }, { dryRun: true }));
		expect(runDeletionWarningEmailsMock).toHaveBeenCalledWith({ dryRun: true });
	});

	it('body なしは dryRun=false 扱い', async () => {
		const req = new Request(ENDPOINT, { method: 'POST', headers: { 'x-cron-secret': SECRET } });
		const res = await post(req);
		expect(res.status).toBe(200);
		expect(runDeletionWarningEmailsMock).toHaveBeenCalledWith({ dryRun: false });
	});

	it('GET は dryRun=true で実行する (副作用なしのヘルスチェック)', async () => {
		const res = await get(new Request(ENDPOINT, { headers: { 'x-cron-secret': SECRET } }));
		expect(res.status).toBe(200);
		expect(runDeletionWarningEmailsMock).toHaveBeenCalledWith({ dryRun: true });
	});
});

describe('#2399 [A3] CRON_SECRET 未設定時の分岐', () => {
	it('AUTH_MODE=local なら認証を skip して 200 (ローカル開発)', async () => {
		process.env.CRON_SECRET = undefined;
		process.env.OPS_SECRET_KEY = undefined;
		process.env.AUTH_MODE = 'local';

		const res = await post(request());
		expect(res.status).toBe(200);
	});

	it('AUTH_MODE≠local なら 401 ではなく 500 (本番の設定漏れを表面化させる)', async () => {
		process.env.CRON_SECRET = undefined;
		process.env.OPS_SECRET_KEY = undefined;
		process.env.AUTH_MODE = 'cognito';

		const res = await post(request());
		expect(res.status).toBe(500);
		expect(runDeletionWarningEmailsMock).not.toHaveBeenCalled();
	});

	it('OPS_SECRET_KEY のみ設定でも認証できる (ADR-0033 後方互換)', async () => {
		process.env.CRON_SECRET = undefined;
		process.env.OPS_SECRET_KEY = 'legacy-secret';
		process.env.AUTH_MODE = 'cognito';

		const res = await post(request({ 'x-cron-secret': 'legacy-secret' }));
		expect(res.status).toBe(200);
	});
});

describe('#2399 [A4] 例外時に内部情報を出さない', () => {
	it('service が throw しても response に例外 message を載せない', async () => {
		runDeletionWarningEmailsMock.mockRejectedValue(
			new Error('connection to host=db.internal password=hunter2 failed'),
		);

		const res = await post(request({ 'x-cron-secret': SECRET }));

		expect(res.status).toBe(500);
		const payload = JSON.stringify(await res.json());
		expect(payload).not.toContain('hunter2');
		expect(payload).not.toContain('db.internal');
	});
});
