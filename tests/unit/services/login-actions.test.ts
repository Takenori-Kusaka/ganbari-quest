// tests/unit/services/login-actions.test.ts
// ログイン server action のセッション cookie テスト (#3022)
// - email/password ログイン成功時に refresh token cookie が保存されること (#1365 適用漏れの回帰防止)
// - MFA 成功時 / confirmCode 自動ログイン成功時も同様
// - refreshToken 不在時は identity cookie のみで失敗しないこと

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Cognito Direct Auth モック ---
const mockAuthenticate = vi.fn();
const mockRespondToMfaChallenge = vi.fn();
const mockConfirmSignUp = vi.fn();
const mockResendConfirmationCode = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-direct-auth', () => ({
	authenticateWithCognito: (...args: unknown[]) => mockAuthenticate(...args),
	respondToMfaChallenge: (...args: unknown[]) => mockRespondToMfaChallenge(...args),
	confirmSignUp: (...args: unknown[]) => mockConfirmSignUp(...args),
	resendConfirmationCode: (...args: unknown[]) => mockResendConfirmationCode(...args),
}));

// --- Cognito OAuth モック (identity / refresh cookie 設定) ---
const mockSetIdentityCookie = vi.fn();
const mockSetRefreshCookie = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-oauth', () => ({
	setIdentityCookie: (...args: unknown[]) => mockSetIdentityCookie(...args),
	setRefreshCookie: (...args: unknown[]) => mockSetRefreshCookie(...args),
}));

// --- Auth Factory モック (本番 cognito モード固定) ---
vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
	isCognitoDevMode: () => false,
}));

// --- Account Lockout モック ---
const mockCheckAccountLockout = vi.fn();
const mockRecordLoginFailure = vi.fn();
const mockResetLoginFailures = vi.fn();
vi.mock('$lib/server/security/account-lockout', () => ({
	checkAccountLockout: (...args: unknown[]) => mockCheckAccountLockout(...args),
	recordLoginFailure: (...args: unknown[]) => mockRecordLoginFailure(...args),
	resetLoginFailures: (...args: unknown[]) => mockResetLoginFailures(...args),
}));

// --- Logger モック ---
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
	mockAuthenticate.mockReset();
	mockRespondToMfaChallenge.mockReset();
	mockConfirmSignUp.mockReset();
	mockResendConfirmationCode.mockReset();
	mockSetIdentityCookie.mockReset();
	mockSetRefreshCookie.mockReset();
	mockCheckAccountLockout.mockReset();
	mockCheckAccountLockout.mockResolvedValue({ locked: false });
	mockRecordLoginFailure.mockReset();
	mockResetLoginFailures.mockReset();
	mockResetLoginFailures.mockResolvedValue(undefined);
});

/** FormData モック */
function createFormData(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) {
		fd.set(k, v);
	}
	return fd;
}

/** RequestEvent モック */
function createEvent(formData: Record<string, string>) {
	const store = new Map<string, string>();
	return {
		request: { formData: () => Promise.resolve(createFormData(formData)) } as unknown as Request,
		cookies: {
			get: (name: string) => store.get(name),
			set: (name: string, value: string, _opts?: unknown) => store.set(name, value),
			delete: (name: string, _opts?: unknown) => store.delete(name),
		},
		locals: { authenticated: false, identity: null, context: null },
	};
}

/** /admin への 302 redirect throw を assert する */
async function expectRedirectToAdmin(promise: Promise<unknown>) {
	try {
		await promise;
		expect.unreachable('should have thrown redirect');
	} catch (e) {
		expect((e as { status: number }).status).toBe(302);
		expect((e as { location: string }).location).toBe('/admin');
	}
}

// ============================================================
// login action (email/password)
// ============================================================
describe('login action — refresh token cookie (#3022)', () => {
	it('ログイン成功時に identity + refresh の両 cookie を設定する', async () => {
		mockAuthenticate.mockResolvedValue({
			success: true,
			idToken: 'id-token-1',
			accessToken: 'access-token-1',
			refreshToken: 'refresh-token-1',
		});

		const { actions } = await import('../../../src/routes/auth/login/+page.server');
		const event = createEvent({ email: 'user@example.com', password: 'Password1' });

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expectRedirectToAdmin((actions.login as any)(event));

		expect(mockSetIdentityCookie).toHaveBeenCalledWith(event.cookies, 'id-token-1');
		expect(mockSetRefreshCookie).toHaveBeenCalledWith(event.cookies, 'refresh-token-1');
		expect(mockResetLoginFailures).toHaveBeenCalledWith('user@example.com');
	});

	it('refreshToken 不在時は identity cookie のみ設定し失敗しない', async () => {
		mockAuthenticate.mockResolvedValue({
			success: true,
			idToken: 'id-token-2',
			accessToken: 'access-token-2',
			refreshToken: undefined,
		});

		const { actions } = await import('../../../src/routes/auth/login/+page.server');
		const event = createEvent({ email: 'user@example.com', password: 'Password1' });

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expectRedirectToAdmin((actions.login as any)(event));

		expect(mockSetIdentityCookie).toHaveBeenCalledWith(event.cookies, 'id-token-2');
		expect(mockSetRefreshCookie).not.toHaveBeenCalled();
	});

	it('認証失敗時はどちらの cookie も設定しない', async () => {
		mockAuthenticate.mockResolvedValue({
			success: false,
			error: 'INVALID_CREDENTIALS',
			message: 'メールアドレスまたはパスワードが正しくありません',
		});
		mockRecordLoginFailure.mockResolvedValue({ locked: false });

		const { actions } = await import('../../../src/routes/auth/login/+page.server');
		const event = createEvent({ email: 'user@example.com', password: 'wrong' });

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.login as any)(event);

		expect(result.status).toBe(401);
		expect(mockSetIdentityCookie).not.toHaveBeenCalled();
		expect(mockSetRefreshCookie).not.toHaveBeenCalled();
	});
});

// ============================================================
// mfa action
// ============================================================
describe('mfa action — refresh token cookie (#3022)', () => {
	it('MFA 成功時に identity + refresh の両 cookie を設定する', async () => {
		mockRespondToMfaChallenge.mockResolvedValue({
			success: true,
			idToken: 'mfa-id-token',
			accessToken: 'mfa-access-token',
			refreshToken: 'mfa-refresh-token',
		});

		const { actions } = await import('../../../src/routes/auth/login/+page.server');
		const event = createEvent({
			session: 'mfa-session',
			mfaCode: '123456',
			challengeName: 'SOFTWARE_TOKEN_MFA',
			email: 'user@example.com',
		});

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expectRedirectToAdmin((actions.mfa as any)(event));

		expect(mockSetIdentityCookie).toHaveBeenCalledWith(event.cookies, 'mfa-id-token');
		expect(mockSetRefreshCookie).toHaveBeenCalledWith(event.cookies, 'mfa-refresh-token');
	});

	it('MFA 成功で refreshToken 不在なら refresh cookie は設定しない', async () => {
		mockRespondToMfaChallenge.mockResolvedValue({
			success: true,
			idToken: 'mfa-id-token',
			accessToken: 'mfa-access-token',
			refreshToken: undefined,
		});

		const { actions } = await import('../../../src/routes/auth/login/+page.server');
		const event = createEvent({
			session: 'mfa-session',
			mfaCode: '123456',
			challengeName: 'SOFTWARE_TOKEN_MFA',
			email: 'user@example.com',
		});

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expectRedirectToAdmin((actions.mfa as any)(event));

		expect(mockSetRefreshCookie).not.toHaveBeenCalled();
	});
});

// ============================================================
// confirmCode action (確認コード → 自動ログイン)
// ============================================================
describe('confirmCode action — refresh token cookie (#3022)', () => {
	it('確認成功 + 自動ログイン成功時に identity + refresh の両 cookie を設定する', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: true,
			idToken: 'auto-id-token',
			accessToken: 'auto-access-token',
			refreshToken: 'auto-refresh-token',
		});

		const { actions } = await import('../../../src/routes/auth/login/+page.server');
		const event = createEvent({
			email: 'user@example.com',
			code: '123456',
			password: 'Password1',
		});

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		await expectRedirectToAdmin((actions.confirmCode as any)(event));

		expect(mockSetIdentityCookie).toHaveBeenCalledWith(event.cookies, 'auto-id-token');
		expect(mockSetRefreshCookie).toHaveBeenCalledWith(event.cookies, 'auto-refresh-token');
	});
});
