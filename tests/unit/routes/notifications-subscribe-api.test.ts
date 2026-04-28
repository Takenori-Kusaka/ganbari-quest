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
				endpoint: 'https://push.example.com/abc',
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
			id: 1,
			tenantId: 'tenant-1',
			endpoint: 'https://push.example.com/abc',
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
				endpoint: 'https://push.example.com/abc',
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
				endpoint: 'https://push.example.com/abc',
				subscriberRole: 'owner',
			}),
		);
	});

	it('既存 endpoint は重複挿入せず success を返す', async () => {
		mockFindByEndpoint.mockResolvedValue({
			id: 99,
			tenantId: 'tenant-1',
			endpoint: 'https://push.example.com/abc',
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
				body: { endpoint: 'https://push.example.com/abc' },
			}),
		);
		expect(res.status).toBe(400);
		expect(mockInsert).not.toHaveBeenCalled();
	});
});
