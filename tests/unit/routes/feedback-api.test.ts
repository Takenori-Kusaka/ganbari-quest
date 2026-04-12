// tests/unit/routes/feedback-api.test.ts
// #839: /api/v1/feedback のバリデーション + レート制限テスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNotifyInquiry = vi.fn();

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyInquiry: mockNotifyInquiry,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/feedback/+server');

function makeEvent(
	opts: { category?: string; text?: string; currentUrl?: string; tenantId?: string | null } = {},
) {
	const body = JSON.stringify({
		category: opts.category ?? 'opinion',
		text: opts.text ?? 'テストフィードバック',
		currentUrl: opts.currentUrl ?? '/admin',
	});
	const request = new Request('http://localhost/api/v1/feedback', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
	});
	const context =
		opts.tenantId === null
			? undefined
			: { tenantId: opts.tenantId ?? 'tenant-1', role: 'owner', licenseStatus: 'none' };
	const identity = opts.tenantId === null ? null : { type: 'local' as const };
	return {
		request,
		locals: { context, identity },
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/feedback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('正常送信: Discord に通知される', async () => {
		mockNotifyInquiry.mockResolvedValue(undefined);

		const response = await POST(makeEvent({ tenantId: 'test-unique-1' }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(mockNotifyInquiry).toHaveBeenCalledTimes(1);
	});

	it('種別なしは 400', async () => {
		await expect(
			POST(makeEvent({ category: '', tenantId: 'test-unique-2' })),
		).rejects.toMatchObject({ status: 400 });
		expect(mockNotifyInquiry).not.toHaveBeenCalled();
	});

	it('不正な種別は 400', async () => {
		await expect(
			POST(makeEvent({ category: 'invalid', tenantId: 'test-unique-3' })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('テキスト空は 400', async () => {
		await expect(POST(makeEvent({ text: '', tenantId: 'test-unique-4' }))).rejects.toMatchObject({
			status: 400,
		});
	});

	it('1000文字超は 400', async () => {
		const longText = 'あ'.repeat(1001);
		await expect(
			POST(makeEvent({ text: longText, tenantId: 'test-unique-5' })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('未認証でも送信可能（匿名フィードバック）', async () => {
		mockNotifyInquiry.mockResolvedValue(undefined);

		const response = await POST(makeEvent({ tenantId: null }));

		expect(response.status).toBe(200);
		expect(mockNotifyInquiry).toHaveBeenCalledTimes(1);
	});

	it('レート制限: 同一テナントから連続送信は 429', async () => {
		mockNotifyInquiry.mockResolvedValue(undefined);
		const tenantId = 'test-rate-limit';

		// 1回目は成功
		const res1 = await POST(makeEvent({ tenantId }));
		expect(res1.status).toBe(200);

		// 2回目は 429
		await expect(POST(makeEvent({ tenantId }))).rejects.toMatchObject({ status: 429 });
	});

	it('全種別が受け付けられる', async () => {
		mockNotifyInquiry.mockResolvedValue(undefined);

		for (const cat of ['opinion', 'bug', 'feature', 'other']) {
			const uniqueTenant = `test-cat-${cat}`;
			const res = await POST(makeEvent({ category: cat, tenantId: uniqueTenant }));
			expect(res.status).toBe(200);
		}
		expect(mockNotifyInquiry).toHaveBeenCalledTimes(4);
	});
});
