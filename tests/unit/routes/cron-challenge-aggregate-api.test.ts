// tests/unit/routes/cron-challenge-aggregate-api.test.ts
// #1742: /api/cron/challenge-aggregate のテスト (PR #1696 と同パターン)
//
// 検証:
//   1. 認証ガード (CRON_SECRET 設定 + ヘッダ不一致 → 401)
//   2. 認証ガード (CRON_SECRET 設定 + ヘッダ一致 → service 呼び出し成功)
//   3. dryRun=true 時に service が dryRun:true で呼ばれる
//   4. service エラー時に 500 + { ok: false, error } 返却
//   5. CRON_SECRET 未設定 + AUTH_MODE=local で認証スキップ
//   6. CRON_SECRET 未設定 + AUTH_MODE=cognito で 500 (設定ミス)
//   7. GET ヘルスチェック (dryRun=true で実行)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		critical: vi.fn(),
		request: vi.fn(),
		requestError: vi.fn(),
	},
}));

const runMock = vi.fn();
vi.mock('$lib/server/services/challenge-aggregate-service', () => ({
	runChallengeAggregation: runMock,
}));

const originalEnv = { ...process.env };

describe('POST /api/cron/challenge-aggregate (#1742)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		process.env.CRON_SECRET = 'test-secret-1742';
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('CRON_SECRET ヘッダなしで POST すると 401', async () => {
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(401);
		expect(runMock).not.toHaveBeenCalled();
	});

	it('CRON_SECRET 不一致で POST すると 401', async () => {
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'wrong' },
			body: JSON.stringify({}),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(401);
		expect(runMock).not.toHaveBeenCalled();
	});

	it('正しい CRON_SECRET + dryRun=true で service が呼ばれ集計結果を返す', async () => {
		runMock.mockResolvedValue({
			ok: true,
			targetDate: '2026-04-30',
			dryRun: true,
			totalTenants: 25,
			challengesPerTenantCount: 25,
			written: false,
			error: null,
		});
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'test-secret-1742' },
			body: JSON.stringify({ dryRun: true }),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
		expect(runMock).toHaveBeenCalledWith({ dryRun: true, targetDate: undefined });
		const body = (await res.json()) as {
			ok: boolean;
			dryRun: boolean;
			targetDate: string;
			totalTenants: number;
		};
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(true);
		expect(body.targetDate).toBe('2026-04-30');
		expect(body.totalTenants).toBe(25);
	});

	it('Authorization: Bearer ヘッダでも認証成功 (AWS dispatcher 経路)', async () => {
		runMock.mockResolvedValue({
			ok: true,
			targetDate: '2026-04-30',
			dryRun: true,
			totalTenants: 0,
			challengesPerTenantCount: 0,
			written: false,
			error: null,
		});
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-secret-1742',
			},
			body: JSON.stringify({ dryRun: true }),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
		expect(runMock).toHaveBeenCalled();
	});

	it('targetDate が指定されていれば service に渡される (YYYY-MM-DD のみ受理)', async () => {
		runMock.mockResolvedValue({
			ok: true,
			targetDate: '2026-04-15',
			dryRun: false,
			totalTenants: 10,
			challengesPerTenantCount: 10,
			written: true,
			error: null,
		});
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'test-secret-1742' },
			body: JSON.stringify({ targetDate: '2026-04-15' }),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
		expect(runMock).toHaveBeenCalledWith({ dryRun: false, targetDate: '2026-04-15' });
	});

	it('targetDate が不正フォーマットなら無視 (undefined で渡される)', async () => {
		runMock.mockResolvedValue({
			ok: true,
			targetDate: '2026-04-30',
			dryRun: true,
			totalTenants: 0,
			challengesPerTenantCount: 0,
			written: false,
			error: null,
		});
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'test-secret-1742' },
			body: JSON.stringify({ dryRun: true, targetDate: 'not-a-date' }),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
		expect(runMock).toHaveBeenCalledWith({ dryRun: true, targetDate: undefined });
	});

	it('service が throw したら 500 + ok:false', async () => {
		runMock.mockRejectedValue(new Error('DynamoDB unavailable'));
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'test-secret-1742' },
			body: JSON.stringify({}),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(500);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toContain('DynamoDB unavailable');
	});

	it('CRON_SECRET 未設定 + AUTH_MODE=local で認証スキップ (200)', async () => {
		delete process.env.CRON_SECRET;
		process.env.AUTH_MODE = 'local';
		runMock.mockResolvedValue({
			ok: true,
			targetDate: '2026-04-30',
			dryRun: true,
			totalTenants: 0,
			challengesPerTenantCount: 0,
			written: false,
			error: null,
		});
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ dryRun: true }),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
	});

	it('CRON_SECRET 未設定 + AUTH_MODE=cognito で 500 (設定ミス)', async () => {
		delete process.env.CRON_SECRET;
		process.env.AUTH_MODE = 'cognito';
		const { POST } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(500);
		expect(runMock).not.toHaveBeenCalled();
	});
});

describe('GET /api/cron/challenge-aggregate (healthcheck)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		process.env.CRON_SECRET = 'test-secret-1742';
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('正しい認証で GET すると dryRun=true で実行', async () => {
		runMock.mockResolvedValue({
			ok: true,
			targetDate: '2026-04-30',
			dryRun: true,
			totalTenants: 0,
			challengesPerTenantCount: 0,
			written: false,
			error: null,
		});
		const { GET } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'GET',
			headers: { 'x-cron-secret': 'test-secret-1742' },
		});
		const res = await GET({ request } as unknown as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		expect(runMock).toHaveBeenCalledWith({ dryRun: true });
	});

	it('認証なしで GET すると 401', async () => {
		const { GET } = await import('../../../src/routes/api/cron/challenge-aggregate/+server');
		const request = new Request('http://localhost/api/cron/challenge-aggregate', {
			method: 'GET',
		});
		const res = await GET({ request } as unknown as Parameters<typeof GET>[0]);
		expect(res.status).toBe(401);
		expect(runMock).not.toHaveBeenCalled();
	});
});
