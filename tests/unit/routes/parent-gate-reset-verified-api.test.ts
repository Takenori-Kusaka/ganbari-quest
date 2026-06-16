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

vi.mock('$lib/server/services/auth-service', () => ({
	setupPin: mockSetupPin,
}));

vi.mock('$lib/server/services/parent-gate-session', () => ({
	createParentSession: vi.fn(() => 'signed-session-value'),
	PARENT_SESSION_COOKIE_NAME: 'gq_parent_session',
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
		newPin?: unknown;
		identity?:
			| { type: string; email?: string; isFederated?: boolean; authTime?: number }
			| undefined;
	} = {},
) {
	const request = new Request('http://localhost/api/v1/parent-gate/reset-verified', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			password: opts.password ?? 'correct-password',
			newPin: opts.newPin ?? '7531',
		}),
	});
	const cookieSet = vi.fn();
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
			cookies: { set: cookieSet },
			getClientAddress: () => '127.0.0.1',
		} as unknown as Parameters<typeof POST>[0],
		cookieSet,
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

	// --- #3025: federated (Google) ユーザ = requires-recent-login 経路 ---

	it('federated + fresh auth_time: password 不要で 200 (re-auth API を呼ばない)', async () => {
		const { event, cookieSet } = makeEvent({
			password: '',
			identity: {
				type: 'cognito',
				email: 'google@example.com',
				isFederated: true,
				authTime: Math.floor(Date.now() / 1000) - 60, // 1 分前 = fresh
			},
		});
		const res = await POST(event);

		expect(res.status).toBe(200);
		expect(mockAuthenticateWithCognito).not.toHaveBeenCalled();
		expect(mockAuthenticateDevUser).not.toHaveBeenCalled();
		expect(mockSetupPin).toHaveBeenCalledWith('7531', 'tenant-1');
		expect(cookieSet).toHaveBeenCalled();
	});

	it('federated + stale auth_time (5 分超): 401 FRESH_LOGIN_REQUIRED で setupPin を呼ばない', async () => {
		const { event } = makeEvent({
			password: '',
			identity: {
				type: 'cognito',
				email: 'google@example.com',
				isFederated: true,
				authTime: Math.floor(Date.now() / 1000) - 10 * 60, // 10 分前 = stale
			},
		});
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: 'FRESH_LOGIN_REQUIRED' });
		expect(mockSetupPin).not.toHaveBeenCalled();
	});

	it('federated + auth_time 欠落: 401 FRESH_LOGIN_REQUIRED (安全側に倒す)', async () => {
		const { event } = makeEvent({
			password: '',
			identity: { type: 'cognito', email: 'google@example.com', isFederated: true },
		});
		const res = await POST(event);

		expect(res.status).toBe(401);
		expect(mockSetupPin).not.toHaveBeenCalled();
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
