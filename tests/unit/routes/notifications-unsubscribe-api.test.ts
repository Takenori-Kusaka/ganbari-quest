// tests/unit/routes/notifications-unsubscribe-api.test.ts
// #3814 (ADR-0062): /api/v1/notifications/unsubscribe の内部例外非露出ガード検証
//
// catch で捕捉した内部例外を client へ返さず (info-disclosure 防止)、
// 汎用 message + 500 を返し詳細は server log のみに残すことを保証する。
// subscribe route (notifications-subscribe-api.test.ts) と対称の防御。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDeleteByEndpoint = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('$lib/server/db/push-subscription-repo', () => ({
	deleteByEndpoint: mockDeleteByEndpoint,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: mockLoggerError, info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/notifications/unsubscribe/+server');

function makeEvent(opts: { tenantId?: string | null; body?: unknown }) {
	const request = new Request('http://localhost/api/v1/notifications/unsubscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(opts.body ?? { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }),
	});
	const context =
		opts.tenantId === null
			? undefined
			: { tenantId: opts.tenantId ?? 'tenant-1', role: 'parent', licenseStatus: 'active' };
	return {
		request,
		locals: { context },
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/notifications/unsubscribe (#3814 ADR-0062)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDeleteByEndpoint.mockResolvedValue(undefined);
	});

	it('未認証 (context なし) は 401 を返す', async () => {
		const res = await POST(makeEvent({ tenantId: null }));
		expect(res.status).toBe(401);
		expect(mockDeleteByEndpoint).not.toHaveBeenCalled();
	});

	it('endpoint 欠落は 400 を返し削除しない', async () => {
		const res = await POST(makeEvent({ body: {} }));
		expect(res.status).toBe(400);
		expect(mockDeleteByEndpoint).not.toHaveBeenCalled();
	});

	it('正常系は tenantId scope で削除し success を返す', async () => {
		const res = await POST(makeEvent({}));
		expect(res.status).toBe(200);
		expect(mockDeleteByEndpoint).toHaveBeenCalledWith(
			'https://fcm.googleapis.com/fcm/send/abc',
			'tenant-1',
		);
		expect(await res.json()).toEqual({ success: true });
	});

	// ============================================================
	// #3814 core: 内部例外を client へ露出しない (ADR-0062)
	// ============================================================

	it('deleteByEndpoint が throw しても内部例外を client へ露出せず汎用 message + 500 を返す', async () => {
		const internalDetail = 'DSQL connection refused at 10.0.0.5:5432 (secret token=abc123)';
		mockDeleteByEndpoint.mockRejectedValue(new Error(internalDetail));

		const res = await POST(makeEvent({}));
		expect(res.status).toBe(500);

		const body = (await res.json()) as { error: string };
		// 汎用 message のみ (subscribe route と対称)
		expect(body.error).toBe('Unsubscription failed');
		// 内部例外の詳細 (host / secret) が一切漏れていない
		expect(body.error).not.toContain('DSQL');
		expect(body.error).not.toContain('10.0.0.5');
		expect(body.error).not.toContain('abc123');
		expect(body.error).not.toContain(internalDetail);
	});

	it('内部例外の詳細は server log にのみ残る', async () => {
		const internalDetail = 'unexpected repo failure';
		mockDeleteByEndpoint.mockRejectedValue(new Error(internalDetail));

		await POST(makeEvent({}));

		// logger.error に tenantId context + 例外 message が記録される
		expect(mockLoggerError).toHaveBeenCalledWith(
			expect.stringContaining('unsubscribe'),
			expect.objectContaining({
				context: expect.objectContaining({ tenantId: 'tenant-1' }),
				error: internalDetail,
			}),
		);
	});
});
