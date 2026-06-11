// tests/unit/routes/parent-gate-setup-api.test.ts
// #2992 (EPIC #2990): POST /api/v1/parent-gate/setup — 初回 PIN 新規作成 API
//
// 「初回は作る・既存は入る」の作成側 enforcement を検証する:
//   - 未設定 tenant のみ作成可 (設定済みへの上書きは 403 = 子供が親の PIN を勝手に再作成する穴の防止)
//   - 成功で setupPin + parent session cookie 発行 (verify 成功と同じ)
//   - PIN format (4-6 桁数字) / rate limit ガード

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsPinConfigured = vi.fn();
const mockSetupPin = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('$lib/server/services/auth-service', () => ({
	isPinConfigured: mockIsPinConfigured,
	setupPin: mockSetupPin,
}));

vi.mock('$lib/server/services/parent-gate-session', () => ({
	createParentSession: vi.fn(() => 'signed-session-value'),
	PARENT_SESSION_COOKIE_NAME: 'gq_parent_session',
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	checkRateLimit: mockCheckRateLimit,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/parent-gate/setup/+server');

function makeEvent(opts: { pin?: unknown; tenantId?: string } = {}) {
	const request = new Request('http://localhost/api/v1/parent-gate/setup', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ pin: opts.pin ?? '4321' }),
	});
	const cookieSet = vi.fn();
	return {
		event: {
			request,
			locals: {
				context: { tenantId: opts.tenantId ?? 'tenant-1', role: 'owner', licenseStatus: 'none' },
				identity: { type: 'local' as const },
			},
			cookies: { set: cookieSet },
			getClientAddress: () => '127.0.0.1',
		} as unknown as Parameters<typeof POST>[0],
		cookieSet,
	};
}

describe('POST /api/v1/parent-gate/setup (#2992)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckRateLimit.mockReturnValue({ allowed: true });
		mockIsPinConfigured.mockResolvedValue(false);
		mockSetupPin.mockResolvedValue(undefined);
	});

	it('未設定 tenant: PIN 作成成功で 200 + setupPin + session cookie 発行', async () => {
		const { event, cookieSet } = makeEvent({ pin: '4321' });
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(mockSetupPin).toHaveBeenCalledWith('4321', 'tenant-1');
		// verify 成功と同じく作成者をそのまま親画面に通す (gq_parent_session 発行)
		expect(cookieSet).toHaveBeenCalledWith(
			'gq_parent_session',
			'signed-session-value',
			expect.objectContaining({ httpOnly: true, path: '/' }),
		);
	});

	it('設定済み tenant: 403 ALREADY_CONFIGURED で setupPin を呼ばない (上書き穴の防止)', async () => {
		mockIsPinConfigured.mockResolvedValue(true);
		const { event, cookieSet } = makeEvent({ pin: '4321' });
		const res = await POST(event);

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ ok: false, error: 'ALREADY_CONFIGURED' });
		expect(mockSetupPin).not.toHaveBeenCalled();
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it('PIN format 不正 (3 桁) は 400 PIN_FORMAT', async () => {
		const { event } = makeEvent({ pin: '123' });
		const res = await POST(event);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, error: 'PIN_FORMAT' });
		expect(mockSetupPin).not.toHaveBeenCalled();
	});

	it('PIN format 不正 (数字以外) は 400 PIN_FORMAT', async () => {
		const { event } = makeEvent({ pin: 'abcd' });
		const res = await POST(event);
		expect(res.status).toBe(400);
		expect(mockSetupPin).not.toHaveBeenCalled();
	});

	it('6 桁は許容される (PIN 仕様 4-6 桁)', async () => {
		const { event } = makeEvent({ pin: '123456' });
		const res = await POST(event);
		expect(res.status).toBe(200);
		expect(mockSetupPin).toHaveBeenCalledWith('123456', 'tenant-1');
	});

	it('rate limit 超過は 429 RATE_LIMITED', async () => {
		mockCheckRateLimit.mockReturnValue({ allowed: false });
		const { event } = makeEvent();
		const res = await POST(event);
		expect(res.status).toBe(429);
		expect(mockSetupPin).not.toHaveBeenCalled();
	});
});
