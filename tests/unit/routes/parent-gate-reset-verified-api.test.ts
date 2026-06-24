// tests/unit/routes/parent-gate-reset-verified-api.test.ts
// #2993 (EPIC #2990): POST /api/v1/parent-gate/reset-verified — パスワード再入力による PIN 再作成 API
//
// セキュリティ核心 (Issue #2993 設計コメント): cognito 認証済みセッション ≠ 親 (家庭内共有端末)。
// セッションだけで reset を許すと子供が gate を突破できるため、子供が知らない
// アカウントパスワードを本人確認に使う。検証ポイント:
//   - local / anonymous identity は 400 NOT_SUPPORTED (local の救済は operator reset #2994)
//   - パスワード不一致は 401 INVALID_PASSWORD で setupPin を呼ばない (gate 突破穴の防止)
//   - MFA_REQUIRED は success 扱い (InitiateAuth でパスワード正解後の第 2 要素要求のため)
//   - 成功で setupPin (上書き) + parent session cookie 発行

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetupPin = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockIsCognitoDevMode = vi.fn();
const mockAuthenticateDevUser = vi.fn();
const mockAuthenticateWithCognito = vi.fn();
const mockVerifyPinResetOtp = vi.fn();

vi.mock('$lib/server/services/auth-service', () => ({
	setupPin: mockSetupPin,
}));

vi.mock('$lib/server/services/parent-gate-session', () => ({
	createParentSession: vi.fn(() => 'signed-session-value'),
	PARENT_SESSION_COOKIE_NAME: 'gq_parent_session',
}));

vi.mock('$lib/server/services/pin-reset-otp', () => ({
	PIN_RESET_OTP_COOKIE_NAME: 'pin_reset_otp',
	verifyPinResetOtp: mockVerifyPinResetOtp,
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	checkRateLimit: mockCheckRateLimit,
}));

vi.mock('$lib/server/auth/factory', () => ({
	isCognitoDevMode: mockIsCognitoDevMode,
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		const tenantId = locals.context?.tenantId;
		if (!tenantId) throw new Error('no tenant');
		return tenantId;
	},
}));

vi.mock('$lib/server/auth/providers/cognito-dev', () => ({
	authenticateDevUser: mockAuthenticateDevUser,
}));

vi.mock('$lib/server/auth/providers/cognito-direct-auth', () => ({
	authenticateWithCognito: mockAuthenticateWithCognito,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/parent-gate/reset-verified/+server');

function makeEvent(
	opts: {
		password?: unknown;
		code?: unknown;
		newPin?: unknown;
		/** OTP cookie の存在 (federated 経路で cookies.get が返す値) */
		otpCookie?: string;
		identity?:
			| { type: string; email?: string; isFederated?: boolean; authTime?: number }
			| undefined;
	} = {},
) {
	const body: Record<string, unknown> = {
		password: opts.password ?? 'correct-password',
		newPin: opts.newPin ?? '7531',
	};
	if ('code' in opts) body.code = opts.code;
	const request = new Request('http://localhost/api/v1/parent-gate/reset-verified', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const cookieSet = vi.fn();
	const cookieDelete = vi.fn();
	const cookieGet = vi.fn(() => opts.otpCookie);
	return {
		event: {
			request,
			locals: {
				context: { tenantId: 'tenant-1', role: 'owner', licenseStatus: 'none' },
				identity:
					'identity' in opts
						? opts.identity
						: { type: 'cognito' as const, userId: 'u-1', email: 'owner@example.com' },
			},
			cookies: { set: cookieSet, get: cookieGet, delete: cookieDelete },
			getClientAddress: () => '127.0.0.1',
		} as unknown as Parameters<typeof POST>[0],
		cookieSet,
		cookieDelete,
		cookieGet,
	};
}

describe('POST /api/v1/parent-gate/reset-verified (#2993)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckRateLimit.mockReturnValue({ allowed: true });
		mockIsCognitoDevMode.mockReturnValue(false);
		mockAuthenticateWithCognito.mockResolvedValue({ success: true });
		mockSetupPin.mockResolvedValue(undefined);
	});

	it('正パスワード: 200 + setupPin (上書き) + parent session cookie 発行', async () => {
		const { event, cookieSet } = makeEvent();
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		// セッション既知の email で re-auth する (手入力 email を受け付けない)
		expect(mockAuthenticateWithCognito).toHaveBeenCalledWith(
			'owner@example.com',
			'correct-password',
		);
		expect(mockSetupPin).toHaveBeenCalledWith('7531', 'tenant-1');
		expect(cookieSet).toHaveBeenCalledWith(
			'gq_parent_session',
			'signed-session-value',
			expect.objectContaining({ httpOnly: true, path: '/' }),
		);
	});

	it('パスワード不一致: 401 INVALID_PASSWORD で setupPin を呼ばない (子供の gate 突破防止)', async () => {
		mockAuthenticateWithCognito.mockResolvedValue({
			success: false,
			error: 'INVALID_CREDENTIALS',
			message: 'x',
		});
		const { event, cookieSet } = makeEvent({ password: 'wrong' });
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: 'INVALID_PASSWORD' });
		expect(mockSetupPin).not.toHaveBeenCalled();
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it('MFA_REQUIRED は success 扱い (パスワード正解後の第 2 要素要求のため)', async () => {
		mockAuthenticateWithCognito.mockResolvedValue({
			success: false,
			error: 'MFA_REQUIRED',
			message: 'x',
			session: 's',
			challengeName: 'SOFTWARE_TOKEN_MFA',
		});
		const { event } = makeEvent();
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(mockSetupPin).toHaveBeenCalledWith('7531', 'tenant-1');
	});

	it('local identity: 400 NOT_SUPPORTED (local の救済は operator reset #2994)', async () => {
		const { event } = makeEvent({ identity: { type: 'local' } });
		const res = await POST(event);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, error: 'NOT_SUPPORTED' });
		expect(mockAuthenticateWithCognito).not.toHaveBeenCalled();
		expect(mockSetupPin).not.toHaveBeenCalled();
	});

	it('cognito-dev mode: DEV_USERS のパスワード照合経路を使う (実 AWS を呼ばない)', async () => {
		mockIsCognitoDevMode.mockReturnValue(true);
		mockAuthenticateDevUser.mockReturnValue({ email: 'owner@example.com' });
		const { event } = makeEvent();
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(mockAuthenticateDevUser).toHaveBeenCalledWith('owner@example.com', 'correct-password');
		expect(mockAuthenticateWithCognito).not.toHaveBeenCalled();
	});

	it('cognito-dev mode: 照合失敗 (null) は 401 INVALID_PASSWORD', async () => {
		mockIsCognitoDevMode.mockReturnValue(true);
		mockAuthenticateDevUser.mockReturnValue(null);
		const { event } = makeEvent({ password: 'wrong' });
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(mockSetupPin).not.toHaveBeenCalled();
	});

	it('PIN format 不正 (3 桁) は 400 PIN_FORMAT で re-auth 前に弾く', async () => {
		const { event } = makeEvent({ newPin: '123' });
		const res = await POST(event);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, error: 'PIN_FORMAT' });
		expect(mockAuthenticateWithCognito).not.toHaveBeenCalled();
	});

	it('password 空は 400 PASSWORD_REQUIRED', async () => {
		const { event } = makeEvent({ password: '' });
		const res = await POST(event);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ ok: false, error: 'PASSWORD_REQUIRED' });
		expect(mockAuthenticateWithCognito).not.toHaveBeenCalled();
	});

	// --- #3070: federated (Google) ユーザ = email-OTP 経路 ---
	// 本人確認は verifyPinResetOtp (署名 cookie 検証) に委譲。endpoint は
	// 「code 必須 / OTP 結果に応じた cookie 更新・clear / 成功で setupPin」の配線を検証する。

	const federatedIdentity = {
		type: 'cognito' as const,
		email: 'google@example.com',
		isFederated: true,
	};

	it('federated + OTP 一致: 200 + setupPin + OTP cookie consume (delete) + session cookie 発行', async () => {
		mockVerifyPinResetOtp.mockReturnValue({ ok: true });
		const { event, cookieSet, cookieDelete } = makeEvent({
			password: '',
			code: '123456',
			otpCookie: 'signed-otp-cookie',
			identity: federatedIdentity,
		});
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		// re-auth API は呼ばない (federated は OTP で本人確認)
		expect(mockAuthenticateWithCognito).not.toHaveBeenCalled();
		expect(mockAuthenticateDevUser).not.toHaveBeenCalled();
		// OTP 検証は cookie + code + tenantId で行う
		expect(mockVerifyPinResetOtp).toHaveBeenCalledWith('signed-otp-cookie', '123456', 'tenant-1');
		expect(mockSetupPin).toHaveBeenCalledWith('7531', 'tenant-1');
		// consume-once: 成功した OTP cookie は delete (同 code 二度目を不可にする)
		expect(cookieDelete).toHaveBeenCalledWith('pin_reset_otp', { path: '/' });
		// parent session 発行
		expect(cookieSet).toHaveBeenCalledWith(
			'gq_parent_session',
			'signed-session-value',
			expect.objectContaining({ httpOnly: true, path: '/' }),
		);
	});

	it('federated + code 欠落: 401 CODE_REQUIRED で OTP 検証も setupPin も呼ばない (先送信誘導)', async () => {
		const { event } = makeEvent({
			password: '',
			// code 未指定
			otpCookie: 'signed-otp-cookie',
			identity: federatedIdentity,
		});
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: 'CODE_REQUIRED' });
		expect(mockVerifyPinResetOtp).not.toHaveBeenCalled();
		expect(mockSetupPin).not.toHaveBeenCalled();
	});

	it('federated + code 形式不正 (5 桁): 401 CODE_REQUIRED で OTP 検証前に弾く', async () => {
		const { event } = makeEvent({
			password: '',
			code: '12345',
			otpCookie: 'signed-otp-cookie',
			identity: federatedIdentity,
		});
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: 'CODE_REQUIRED' });
		expect(mockVerifyPinResetOtp).not.toHaveBeenCalled();
		expect(mockSetupPin).not.toHaveBeenCalled();
	});

	it('federated + OTP 不一致 (残試行あり): 401 INVALID_CODE + cookie 再 set + setupPin 呼ばない', async () => {
		mockVerifyPinResetOtp.mockReturnValue({
			ok: false,
			reason: 'INVALID_CODE',
			nextCookie: 're-signed-otp-cookie',
		});
		const { event, cookieSet, cookieDelete } = makeEvent({
			password: '',
			code: '000000',
			otpCookie: 'signed-otp-cookie',
			identity: federatedIdentity,
		});
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: 'INVALID_CODE' });
		expect(mockSetupPin).not.toHaveBeenCalled();
		// 残試行を継続するため OTP cookie を再 set (attempts +1)
		expect(cookieSet).toHaveBeenCalledWith(
			'pin_reset_otp',
			're-signed-otp-cookie',
			expect.objectContaining({ httpOnly: true, path: '/' }),
		);
		// session cookie は発行しない
		expect(cookieSet).not.toHaveBeenCalledWith(
			'gq_parent_session',
			expect.anything(),
			expect.anything(),
		);
		expect(cookieDelete).not.toHaveBeenCalled();
	});

	it('federated + OTP 失効: 401 CODE_EXPIRED + cookie clear + setupPin 呼ばない', async () => {
		mockVerifyPinResetOtp.mockReturnValue({
			ok: false,
			reason: 'CODE_EXPIRED',
			nextCookie: null,
		});
		const { event, cookieDelete } = makeEvent({
			password: '',
			code: '123456',
			otpCookie: 'signed-otp-cookie',
			identity: federatedIdentity,
		});
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: 'CODE_EXPIRED' });
		expect(mockSetupPin).not.toHaveBeenCalled();
		// 失効した OTP cookie は clear
		expect(cookieDelete).toHaveBeenCalledWith('pin_reset_otp', { path: '/' });
	});

	it('federated + 試行上限到達: 401 TOO_MANY_ATTEMPTS + cookie clear + setupPin 呼ばない', async () => {
		mockVerifyPinResetOtp.mockReturnValue({
			ok: false,
			reason: 'TOO_MANY_ATTEMPTS',
			nextCookie: null,
		});
		const { event, cookieDelete } = makeEvent({
			password: '',
			code: '000000',
			otpCookie: 'signed-otp-cookie',
			identity: federatedIdentity,
		});
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
		expect(mockSetupPin).not.toHaveBeenCalled();
		expect(cookieDelete).toHaveBeenCalledWith('pin_reset_otp', { path: '/' });
	});

	it('rate limit 超過は 429 RATE_LIMITED (パスワード brute force 防止)', async () => {
		mockCheckRateLimit.mockReturnValue({ allowed: false });
		const { event } = makeEvent();
		const res = await POST(event);

		expect(res.status).toBe(429);
		expect(mockAuthenticateWithCognito).not.toHaveBeenCalled();
		expect(mockSetupPin).not.toHaveBeenCalled();
	});
});
