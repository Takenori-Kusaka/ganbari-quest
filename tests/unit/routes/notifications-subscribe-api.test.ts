// tests/unit/routes/notifications-subscribe-api.test.ts
// #1593 (ADR-0023 I6): /api/v1/notifications/subscribe の child role 拒否ガード検証
//
// COPPA 改正 + ADR-0012 Anti-engagement の二重リスク対策として、
// child role からの push 通知 subscribe を構造的に拒否することを保証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByEndpoint = vi.fn();
const mockInsert = vi.fn();

vi.mock('$lib/server/db/push-subscription-repo', () => ({
	findByEndpoint: mockFindByEndpoint,
	insert: mockInsert,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// #3404 item3: validation 拒否の可視化 (structured log + Discord alert) は結線のみ検証
const mockReportRejection = vi.fn();
vi.mock('$lib/server/services/push-validation-alert', () => ({
	reportPushValidationRejection: mockReportRejection,
}));

const { POST } = await import('../../../src/routes/api/v1/notifications/subscribe/+server');

type Role = 'owner' | 'parent' | 'child';

function makeEvent(opts: {
	role?: Role;
	tenantId?: string | null;
	body?: unknown;
	userAgent?: string;
}) {
	const request = new Request('http://localhost/api/v1/notifications/subscribe', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(opts.userAgent ? { 'user-agent': opts.userAgent } : {}),
		},
		body: JSON.stringify(
			opts.body ?? {
				endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
				keys: { p256dh: 'p256-key', auth: 'auth-key' },
			},
		),
	});
	const context =
		opts.tenantId === null
			? undefined
			: {
					tenantId: opts.tenantId ?? 'tenant-1',
					role: opts.role ?? 'parent',
					licenseStatus: 'active',
					childId: opts.role === 'child' ? 42 : undefined,
				};
	return {
		request,
		locals: { context },
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/notifications/subscribe (#1593 ADR-0023 I6)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindByEndpoint.mockResolvedValue(undefined);
		mockInsert.mockResolvedValue({
			id: '1',
			tenantId: 'tenant-1',
			endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
			keysP256dh: 'p256-key',
			keysAuth: 'auth-key',
			userAgent: null,
			subscriberRole: 'parent',
			createdAt: '2026-04-27T00:00:00.000Z',
		});
	});

	// ============================================================
	// 認証ガード
	// ============================================================

	it('未認証 (context なし) は 401 を返す', async () => {
		const res = await POST(makeEvent({ tenantId: null }));
		expect(res.status).toBe(401);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	// ============================================================
	// #1593: child role 拒否（構造的防御）
	// ============================================================

	it('child role からの subscribe は 403 で拒否される', async () => {
		const res = await POST(makeEvent({ role: 'child' }));
		expect(res.status).toBe(403);
		expect(mockInsert).not.toHaveBeenCalled();

		const body = (await res.json()) as { error: string; code: string };
		expect(body.code).toBe('CHILD_FORBIDDEN');
		// エラーメッセージは SSOT (labels.ts) を経由
		expect(body.error).toContain('お子さま用アカウント');
	});

	it('child role 拒否時は findByEndpoint も呼ばれない（DB 副作用なし）', async () => {
		await POST(makeEvent({ role: 'child' }));
		expect(mockFindByEndpoint).not.toHaveBeenCalled();
		expect(mockInsert).not.toHaveBeenCalled();
	});

	// ============================================================
	// parent / owner: 正常系
	// ============================================================

	it('parent role からの subscribe は subscriberRole=parent で挿入', async () => {
		const res = await POST(makeEvent({ role: 'parent' }));
		expect(res.status).toBe(200);
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: 'tenant-1',
				endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
				subscriberRole: 'parent',
			}),
		);
	});

	it('owner role からの subscribe は subscriberRole=owner で挿入', async () => {
		const res = await POST(makeEvent({ role: 'owner' }));
		expect(res.status).toBe(200);
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: 'tenant-1',
				endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
				subscriberRole: 'owner',
			}),
		);
	});

	it('既存 endpoint は重複挿入せず success を返す', async () => {
		mockFindByEndpoint.mockResolvedValue({
			id: '99',
			tenantId: 'tenant-1',
			endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
			keysP256dh: 'p',
			keysAuth: 'a',
			userAgent: null,
			subscriberRole: 'parent',
			createdAt: '',
		});
		const res = await POST(makeEvent({ role: 'parent' }));
		expect(res.status).toBe(200);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	// ============================================================
	// 入力バリデーション
	// ============================================================

	it('endpoint が欠落している場合 400', async () => {
		const res = await POST(
			makeEvent({
				role: 'parent',
				body: { keys: { p256dh: 'p', auth: 'a' } },
			}),
		);
		expect(res.status).toBe(400);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('keys が欠落している場合 400', async () => {
		const res = await POST(
			makeEvent({
				role: 'parent',
				body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
			}),
		);
		expect(res.status).toBe(400);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	// #3188 SSRF hardening: allowlist 外 / internal host の endpoint を 400 で拒否し保存しない
	it('allowlist 外 endpoint (internal host) は 400 で拒否し insert しない', async () => {
		const res = await POST(
			makeEvent({
				role: 'parent',
				body: {
					endpoint: 'https://169.254.169.254/latest/meta-data/',
					keys: { p256dh: 'p256-key', auth: 'auth-key' },
				},
			}),
		);
		expect(res.status).toBe(400);
		expect(mockInsert).not.toHaveBeenCalled();
		// #3404 item3: INVALID_ENDPOINT 発生が可視化基盤へ report される
		expect(mockReportRejection).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: 'tenant-1',
				code: 'INVALID_ENDPOINT',
				reason: expect.any(String),
			}),
		);
	});

	// ============================================================
	// #3404 item2: url.href 正規化保存
	// ============================================================

	it('大文字 host / default port の endpoint は正規化形 (.href) で保存される', async () => {
		const res = await POST(
			makeEvent({
				role: 'parent',
				body: {
					endpoint: 'https://FCM.googleapis.com:443/fcm/send/abc',
					keys: { p256dh: 'p256-key', auth: 'auth-key' },
				},
			}),
		);
		expect(res.status).toBe(200);
		// 既存チェックも正規化形で照合される
		expect(mockFindByEndpoint).toHaveBeenCalledWith(
			'https://fcm.googleapis.com/fcm/send/abc',
			'tenant-1',
		);
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
			}),
		);
	});

	it('正規化形で miss しても raw 形で保存済みの既存レコードと fallback 照合し重複 insert しない', async () => {
		const rawEndpoint = 'https://FCM.googleapis.com:443/fcm/send/abc';
		// 正規化形 lookup は miss、raw 形 lookup で hit する既存レコード (正規化導入前の保存分)
		mockFindByEndpoint.mockImplementation(async (endpoint: string) =>
			endpoint === rawEndpoint
				? {
						id: '77',
						tenantId: 'tenant-1',
						endpoint: rawEndpoint,
						keysP256dh: 'p',
						keysAuth: 'a',
						userAgent: null,
						subscriberRole: 'parent',
						createdAt: '',
					}
				: undefined,
		);
		const res = await POST(
			makeEvent({
				role: 'parent',
				body: {
					endpoint: rawEndpoint,
					keys: { p256dh: 'p256-key', auth: 'auth-key' },
				},
			}),
		);
		expect(res.status).toBe(200);
		expect(mockInsert).not.toHaveBeenCalled();
		// 正規化形 → raw 形の順で 2 回照合される
		expect(mockFindByEndpoint).toHaveBeenNthCalledWith(
			1,
			'https://fcm.googleapis.com/fcm/send/abc',
			'tenant-1',
		);
		expect(mockFindByEndpoint).toHaveBeenNthCalledWith(2, rawEndpoint, 'tenant-1');
	});

	it('入力が既に正規化形なら raw 形 fallback 照合は行わない (lookup 1 回)', async () => {
		const res = await POST(makeEvent({ role: 'parent' }));
		expect(res.status).toBe(200);
		expect(mockFindByEndpoint).toHaveBeenCalledTimes(1);
	});

	it('非 https endpoint は 400 で拒否する', async () => {
		const res = await POST(
			makeEvent({
				role: 'parent',
				body: {
					endpoint: 'http://fcm.googleapis.com/fcm/send/abc',
					keys: { p256dh: 'p256-key', auth: 'auth-key' },
				},
			}),
		);
		expect(res.status).toBe(400);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	// #3188: 不正な key 形式 (制御文字 / 過長) も 400 で拒否
	it('不正な key 形式は 400 で拒否する', async () => {
		const res = await POST(
			makeEvent({
				role: 'parent',
				body: {
					endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
					keys: { p256dh: 'has space', auth: 'auth-key' },
				},
			}),
		);
		expect(res.status).toBe(400);
		expect(mockInsert).not.toHaveBeenCalled();
		// #3404 item3: INVALID_KEY 発生が可視化基盤へ report される
		expect(mockReportRejection).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: 'tenant-1',
				code: 'INVALID_KEY',
				reason: expect.any(String),
			}),
		);
	});

	it('正常 subscribe では validation 拒否 report は発火しない', async () => {
		const res = await POST(makeEvent({ role: 'parent' }));
		expect(res.status).toBe(200);
		expect(mockReportRejection).not.toHaveBeenCalled();
	});
});
