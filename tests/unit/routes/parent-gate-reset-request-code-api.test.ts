// tests/unit/routes/parent-gate-reset-request-code-api.test.ts
// #3070: POST /api/v1/parent-gate/reset-request-code — federated email-OTP 発行
//
// 検証ポイント (Issue #3070):
//   - cognito + federated のみ対象 (それ以外 / password ユーザは 400 NOT_SUPPORTED)
//   - OTP を発行し署名 cookie を set + 登録メールへ確認コードを送信
//   - enumeration 防止: 送信成否に依らず常に { ok: true }
//   - rate limit 超過は 429 RATE_LIMITED

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckRateLimit = vi.fn();
const mockSendPinResetCodeEmail = vi.fn();
const mockIssuePinResetOtp = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		const tenantId = locals.context?.tenantId;
		if (!tenantId) throw new Error('no tenant');
		return tenantId;
	},
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	checkRateLimit: mockCheckRateLimit,
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendPinResetCodeEmail: mockSendPinResetCodeEmail,
}));

vi.mock('$lib/server/services/pin-reset-otp', () => ({
	PIN_RESET_OTP_COOKIE_NAME: 'pin_reset_otp',
	PIN_RESET_OTP_COOKIE_MAX_AGE_SEC: 600,
	issuePinResetOtp: mockIssuePinResetOtp,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/parent-gate/reset-request-code/+server');

function makeEvent(identity?: { type: string; email?: string; isFederated?: boolean } | undefined) {
	const cookieSet = vi.fn();
	return {
		event: {
			locals: {
				context: { tenantId: 'tenant-1', role: 'owner', licenseStatus: 'none' },
				identity:
					identity === undefined
						? { type: 'cognito', email: 'google@example.com', isFederated: true }
						: identity,
			},
			cookies: { set: cookieSet },
			getClientAddress: () => '127.0.0.1',
		} as unknown as Parameters<typeof POST>[0],
		cookieSet,
	};
}

describe('POST /api/v1/parent-gate/reset-request-code (#3070)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckRateLimit.mockReturnValue({ allowed: true });
		mockIssuePinResetOtp.mockReturnValue({ code: '123456', cookieValue: 'signed-otp-cookie' });
		mockSendPinResetCodeEmail.mockResolvedValue(true);
	});

	it('federated: OTP 発行 + cookie set + メール送信 + { ok: true }', async () => {
		const { event, cookieSet } = makeEvent();
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(mockIssuePinResetOtp).toHaveBeenCalledWith('tenant-1');
		expect(cookieSet).toHaveBeenCalledWith(
			'pin_reset_otp',
			'signed-otp-cookie',
			expect.objectContaining({ httpOnly: true, path: '/', maxAge: 600 }),
		);
		// code はセッション既知の email にのみ送る (手入力なし)
		expect(mockSendPinResetCodeEmail).toHaveBeenCalledWith('google@example.com', '123456');
	});

	it('password ユーザ (federated でない cognito): 400 NOT_SUPPORTED で OTP 発行しない', async () => {
		const { event, cookieSet } = makeEvent({
			type: 'cognito',
			email: 'owner@example.com',
			isFederated: false,
		});
		const res = await POST(event);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, error: 'NOT_SUPPORTED' });
		expect(mockIssuePinResetOtp).not.toHaveBeenCalled();
		expect(mockSendPinResetCodeEmail).not.toHaveBeenCalled();
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it('local identity: 400 NOT_SUPPORTED', async () => {
		const { event } = makeEvent({ type: 'local' });
		const res = await POST(event);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, error: 'NOT_SUPPORTED' });
		expect(mockIssuePinResetOtp).not.toHaveBeenCalled();
	});

	it('メール送信失敗でも { ok: true } を返す (enumeration / 状態漏洩防止)', async () => {
		mockSendPinResetCodeEmail.mockRejectedValue(new Error('SES down'));
		const { event, cookieSet } = makeEvent();
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		// cookie は send 前に set 済 (応答一定化)
		expect(cookieSet).toHaveBeenCalled();
	});

	it('rate limit 超過は 429 RATE_LIMITED で OTP 発行しない', async () => {
		mockCheckRateLimit.mockReturnValue({ allowed: false });
		const { event } = makeEvent();
		const res = await POST(event);

		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ ok: false, error: 'RATE_LIMITED' });
		expect(mockIssuePinResetOtp).not.toHaveBeenCalled();
		expect(mockSendPinResetCodeEmail).not.toHaveBeenCalled();
	});
});
