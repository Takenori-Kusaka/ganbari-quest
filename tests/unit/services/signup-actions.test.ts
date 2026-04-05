// tests/unit/services/signup-actions.test.ts
// サインアップ server action のロジックテスト
// - signup: バリデーション + Cognito SignUp 呼び出し
// - confirm: 確認コード検証 + 自動ログイン
// - 確認ステップでの email 引き渡しが正しく行われることを検証

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Cognito Direct Auth モック ---
const mockSignUp = vi.fn();
const mockConfirmSignUp = vi.fn();
const mockAuthenticate = vi.fn();
const mockResendConfirmationCode = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-direct-auth', () => ({
	signUpWithCognito: (...args: unknown[]) => mockSignUp(...args),
	confirmSignUp: (...args: unknown[]) => mockConfirmSignUp(...args),
	authenticateWithCognito: (...args: unknown[]) => mockAuthenticate(...args),
	resendConfirmationCode: (...args: unknown[]) => mockResendConfirmationCode(...args),
}));

// --- Cognito OAuth モック ---
const mockSetIdentityCookie = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-oauth', () => ({
	setIdentityCookie: (...args: unknown[]) => mockSetIdentityCookie(...args),
}));

// --- Auth Factory モック ---
vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
	isCognitoDevMode: () => false,
}));

// --- Logger モック ---
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// --- Consent Service モック ---
vi.mock('$lib/server/services/consent-service', () => ({
	recordConsent: vi.fn().mockResolvedValue(undefined),
	checkConsent: vi.fn().mockResolvedValue({ needsReconsent: false }),
	CURRENT_TERMS_VERSION: '2026-03-29',
	CURRENT_PRIVACY_VERSION: '2026-03-29',
}));

// --- Discord Notify Service モック ---
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyNewSignup: vi.fn().mockResolvedValue(undefined),
}));

// --- License Key Service モック ---
vi.mock('$lib/server/services/license-key-service', () => ({
	validateLicenseKey: vi.fn().mockResolvedValue({ valid: true, key: null }),
	consumeLicenseKey: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
	mockSignUp.mockReset();
	mockConfirmSignUp.mockReset();
	mockAuthenticate.mockReset();
	mockSetIdentityCookie.mockReset();
	mockResendConfirmationCode.mockReset();
});

/** FormData モック */
function createFormData(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) {
		fd.set(k, v);
	}
	return fd;
}

/** Request モック */
function createRequest(data: Record<string, string>): Request {
	const fd = createFormData(data);
	return { formData: () => Promise.resolve(fd) } as unknown as Request;
}

/** Cookies モック */
function createMockCookies() {
	const store = new Map<string, string>();
	return {
		get: (name: string) => store.get(name),
		set: (name: string, value: string, _opts?: unknown) => store.set(name, value),
		delete: (name: string, _opts?: unknown) => store.delete(name),
		_store: store,
	};
}

/** Mock locals (context is null for unauthenticated signup) */
const mockLocals = { authenticated: false, identity: null, context: null };

// ============================================================
// signup action
// ============================================================
describe('signup action', () => {
	it('規約未同意で 400 エラーを返す', async () => {
		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			password: 'Password1',
			passwordConfirm: 'Password1',
		});
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.signup as any)({ request, locals: mockLocals });

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('同意が必要');
	});

	it('空のフィールドで 400 エラーを返す', async () => {
		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: '',
			password: '',
			passwordConfirm: '',
			agreedTerms: 'on',
			agreedPrivacy: 'on',
		});
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.signup as any)({ request, locals: mockLocals });

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('全ての項目');
	});

	it('パスワード不一致で 400 エラーを返す', async () => {
		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			password: 'Password1',
			passwordConfirm: 'Different1',
			agreedTerms: 'on',
			agreedPrivacy: 'on',
		});
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.signup as any)({ request, locals: mockLocals });

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('パスワードが一致しません');
	});

	it('パスワード8文字未満で 400 エラーを返す', async () => {
		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			password: 'Short1',
			passwordConfirm: 'Short1',
			agreedTerms: 'on',
			agreedPrivacy: 'on',
		});
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.signup as any)({ request, locals: mockLocals });

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('8文字以上');
	});

	it('サインアップ成功時に confirmStep=true と email を返す', async () => {
		mockSignUp.mockResolvedValue({ success: true, userConfirmed: false });

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			password: 'Password1',
			passwordConfirm: 'Password1',
			agreedTerms: 'on',
			agreedPrivacy: 'on',
		});
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.signup as any)({ request, locals: mockLocals });

		// 成功レスポンス（fail ではない）
		expect(result.confirmStep).toBe(true);
		expect(result.email).toBe('test@example.com');
	});

	it('Cognito エラー時に fail を返しemail を保持する', async () => {
		mockSignUp.mockResolvedValue({
			success: false,
			error: 'UNKNOWN',
			message: 'このメールアドレスは既に登録されています',
		});

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'existing@example.com',
			password: 'Password1',
			passwordConfirm: 'Password1',
			agreedTerms: 'on',
			agreedPrivacy: 'on',
		});
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.signup as any)({ request, locals: mockLocals });

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('既に登録されています');
		expect(result.data.email).toBe('existing@example.com');
	});
});

// ============================================================
// confirm action
// ============================================================
describe('confirm action', () => {
	it('email/code が空の場合 400 エラーを返し confirmStep を維持', async () => {
		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({ email: '', code: '' });
		const cookies = createMockCookies();
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.confirm as any)({ request, cookies, locals: mockLocals });

		expect(result.status).toBe(400);
		expect(result.data.confirmStep).toBe(true);
	});

	it('確認コード不正で 400 エラーを返す', async () => {
		mockConfirmSignUp.mockResolvedValue({
			success: false,
			error: 'UNKNOWN',
			message: '確認コードが正しくありません',
		});

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			code: '000000',
		});
		const cookies = createMockCookies();
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.confirm as any)({ request, cookies, locals: mockLocals });

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('確認コード');
		expect(result.data.email).toBe('test@example.com');
		expect(result.data.confirmStep).toBe(true);
	});

	it('確認成功 + パスワードあり → 自動ログインして /admin にリダイレクト', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: true,
			idToken: 'new-id-token',
			accessToken: 'new-access-token',
		});

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});
		const cookies = createMockCookies();

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)({ request, cookies, locals: mockLocals });
			// redirect は throw されるのでここには来ないはず
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			// SvelteKit redirect
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}

		// Cookie にトークンがセットされたことを確認
		expect(mockSetIdentityCookie).toHaveBeenCalledWith(cookies, 'new-id-token');
	});

	it('確認成功 + パスワードなし → /auth/login にリダイレクト', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			code: '123456',
		});
		const cookies = createMockCookies();

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)({ request, cookies, locals: mockLocals });
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}

		// 自動ログインは試みられていない
		expect(mockAuthenticate).not.toHaveBeenCalled();
	});

	it('確認成功 + 自動ログイン失敗 → /auth/login にフォールバック', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: false,
			error: 'UNKNOWN',
			message: 'ログイン失敗',
		});

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});
		const cookies = createMockCookies();

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)({ request, cookies, locals: mockLocals });
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}
	});

	it('確認成功 + MFA チャレンジ → /auth/login にフォールバック', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: false,
			error: 'MFA_REQUIRED',
			message: 'MFA必要',
			session: 'mfa-session',
			challengeName: 'SOFTWARE_TOKEN_MFA',
		});

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});
		const cookies = createMockCookies();

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)({ request, cookies, locals: mockLocals });
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}
	});
});

// ============================================================
// resend action
// ============================================================
describe('resend action', () => {
	it('email が空の場合 400 エラーを返す', async () => {
		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({ email: '' });
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.resend as any)({ request });

		expect(result.status).toBe(400);
		expect(result.data.confirmStep).toBe(true);
	});

	it('再送成功時に confirmStep=true, resent=true を返す', async () => {
		mockResendConfirmationCode.mockResolvedValue({ success: true });

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({ email: 'test@example.com' });
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.resend as any)({ request });

		expect(result.confirmStep).toBe(true);
		expect(result.email).toBe('test@example.com');
		expect(result.resent).toBe(true);
	});

	it('再送失敗時に 400 エラーを返す', async () => {
		mockResendConfirmationCode.mockResolvedValue({
			success: false,
			error: 'UNKNOWN',
			message: '再送回数の上限に達しました。しばらくしてからお試しください',
		});

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const request = createRequest({ email: 'test@example.com' });
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.resend as any)({ request });

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('上限');
		expect(result.data.confirmStep).toBe(true);
	});
});
