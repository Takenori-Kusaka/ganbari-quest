// tests/unit/routes/cron-auth-3-endpoints.test.ts
// #1377 (#1374 Sub A-3): 既存 3 cron endpoint の認証共通検証
//
// 検証範囲:
//   1. CRON_SECRET 未設定時の挙動 (AUTH_MODE=local skip / それ以外 500)
//   2. ヘッダなしで 401
//   3. 不正 Bearer / 不正 x-cron-secret で 401
//   4. 正しい Authorization: Bearer で認証成功 (AWS dispatcher 互換)
//   5. 正しい x-cron-secret で認証成功 (NUC scheduler 互換)
//   6. OPS_SECRET_KEY (legacy ADR-0033 archive) も両ヘッダで通る
//
// 背景:
//   #1377 Sub A-3 で発覚した bug — verifyCronAuth は元々 x-cron-secret のみを受け入れていたため
//   AWS cron-dispatcher (Authorization: Bearer 送信) からの retention-cleanup / trial-notifications
//   呼び出しが 401 で silent fail していた可能性があった。両ヘッダ受け入れに統一し、
//   3 endpoint すべてが同じ認証ヘルパー (verifyCronAuth) を使う構成に修正済み。

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

const expireLicenseKeysMock = vi.fn();
vi.mock('$lib/server/services/license-key-service', () => ({
	expireLicenseKeys: expireLicenseKeysMock,
}));

const cleanupExpiredDataMock = vi.fn();
vi.mock('$lib/server/services/retention-cleanup-service', () => ({
	cleanupExpiredData: cleanupExpiredDataMock,
}));

const processTrialNotificationsMock = vi.fn();
vi.mock('$lib/server/services/trial-notification-service', () => ({
	processTrialNotifications: processTrialNotificationsMock,
}));

const findActiveTrialsMock = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		trialHistory: {
			findActiveTrials: findActiveTrialsMock,
		},
	}),
}));

const originalEnv = { ...process.env };
const SECRET = 'test-cron-secret-1377';

interface EndpointConfig {
	name: string;
	path: string;
	importPath: string;
	successResultMock: () => void;
}

const ENDPOINTS: EndpointConfig[] = [
	{
		name: 'license-expire',
		path: '/api/cron/license-expire',
		importPath: '../../../src/routes/api/cron/license-expire/+server',
		successResultMock: () =>
			expireLicenseKeysMock.mockResolvedValue({
				scanned: 0,
				revoked: 0,
				failures: [],
				dryRun: true,
			}),
	},
	{
		name: 'retention-cleanup',
		path: '/api/cron/retention-cleanup',
		importPath: '../../../src/routes/api/cron/retention-cleanup/+server',
		successResultMock: () =>
			cleanupExpiredDataMock.mockResolvedValue({
				tenantsProcessed: 0,
				tenantsSkipped: 0,
				childrenProcessed: 0,
				activityLogsDeleted: 0,
				pointLedgerDeleted: 0,
				loginBonusesDeleted: 0,
				errors: [],
			}),
	},
	{
		name: 'trial-notifications',
		path: '/api/cron/trial-notifications',
		importPath: '../../../src/routes/api/cron/trial-notifications/+server',
		successResultMock: () => {
			findActiveTrialsMock.mockResolvedValue([]);
			processTrialNotificationsMock.mockResolvedValue({ sent: 0, skipped: 0, errors: 0 });
		},
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv };
	// AUTH_MODE をテストの想定モードへ明示的に切り替えるため、デフォルトでは外す
	delete process.env.AUTH_MODE;
});

afterEach(() => {
	process.env = originalEnv;
});

for (const ep of ENDPOINTS) {
	describe(`#1377 cron auth — ${ep.name}`, () => {
		it('ヘッダなしで POST すると 401 (CRON_SECRET 設定時)', async () => {
			process.env.CRON_SECRET = SECRET;
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(401);
		});

		it('不正な Bearer で POST すると 401', async () => {
			process.env.CRON_SECRET = SECRET;
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer wrong-secret',
				},
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(401);
		});

		it('不正な x-cron-secret で POST すると 401', async () => {
			process.env.CRON_SECRET = SECRET;
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-cron-secret': 'wrong-secret',
				},
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(401);
		});

		it('正しい Authorization: Bearer (AWS dispatcher 互換) で 200', async () => {
			process.env.CRON_SECRET = SECRET;
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${SECRET}`,
				},
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(200);
		});

		it('正しい x-cron-secret (NUC scheduler 互換) で 200', async () => {
			process.env.CRON_SECRET = SECRET;
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-cron-secret': SECRET,
				},
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(200);
		});

		it('OPS_SECRET_KEY (legacy fallback) でも認証通過', async () => {
			delete process.env.CRON_SECRET;
			process.env.OPS_SECRET_KEY = SECRET;
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${SECRET}`,
				},
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(200);
		});

		it('CRON_SECRET / OPS_SECRET_KEY 共に未設定 + AUTH_MODE 非 local で 500', async () => {
			delete process.env.CRON_SECRET;
			delete process.env.OPS_SECRET_KEY;
			process.env.AUTH_MODE = 'cognito';
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(500);
		});

		it('CRON_SECRET 未設定 + AUTH_MODE=local では認証スキップ', async () => {
			delete process.env.CRON_SECRET;
			delete process.env.OPS_SECRET_KEY;
			process.env.AUTH_MODE = 'local';
			ep.successResultMock();
			const { POST } = await import(ep.importPath);
			const request = new Request(`http://localhost${ep.path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const res = await POST({ request } as unknown as Parameters<typeof POST>[0]);
			expect(res.status).toBe(200);
		});
	});
}
