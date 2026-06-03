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

// --- Cognito JWT モック (#589: confirm action で identity 解決のため追加) ---
const mockVerifyIdentityToken = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-jwt', () => ({
	verifyIdentityToken: (...args: unknown[]) => mockVerifyIdentityToken(...args),
}));

// --- Auth Factory モック ---
// #589: confirm action で tenant provisioning のため getAuthProvider を追加
const mockResolveContext = vi.fn();
const mockAuthProvider = { resolveContext: mockResolveContext };
vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
	isCognitoDevMode: () => false,
	getAuthProvider: () => mockAuthProvider,
}));

// --- Logger モック ---
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// --- Consent Service モック ---
const mockRecordConsent = vi.fn();
vi.mock('$lib/server/services/consent-service', () => ({
	recordConsent: (...args: unknown[]) => mockRecordConsent(...args),
	checkConsent: vi.fn().mockResolvedValue({ needsReconsent: false }),
	CURRENT_TERMS_VERSION: '2026-03-29',
	CURRENT_PRIVACY_VERSION: '2026-04-09',
}));

// --- Discord Notify Service モック ---
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyNewSignup: vi.fn().mockResolvedValue(undefined),
}));

// --- License Key Service モック ---
// Phase 1 補強 3 §3.1: signup の license key 入力経路を削除済。
// confirm action は license-key-service を import しないため本 mock は発火しないが、
// 「license key 経路が呼ばれないこと」を回帰防止 assert する目的で consumeLicenseKey spy を残す。
const mockConsumeLicenseKey = vi.fn().mockResolvedValue({ ok: true, plan: 'monthly' });
vi.mock('$lib/server/services/license-key-service', () => ({
	consumeLicenseKey: (...args: unknown[]) => mockConsumeLicenseKey(...args),
}));

// --- Trial Service モック (#766) ---
const mockStartTrial = vi.fn();
vi.mock('$lib/server/services/trial-service', () => ({
	startTrial: (...args: unknown[]) => mockStartTrial(...args),
}));

// --- Analytics Service モック (#831) ---
vi.mock('$lib/server/services/analytics-service', () => ({
	trackActivationSignupCompleted: vi.fn(),
}));

beforeEach(() => {
	mockSignUp.mockReset();
	mockConfirmSignUp.mockReset();
	mockAuthenticate.mockReset();
	mockSetIdentityCookie.mockReset();
	mockResendConfirmationCode.mockReset();
	mockVerifyIdentityToken.mockReset();
	mockResolveContext.mockReset();
	mockRecordConsent.mockReset();
	mockRecordConsent.mockResolvedValue(undefined);
	// license key モックも毎回リセット（回帰防止 assert 用）
	mockConsumeLicenseKey.mockReset();
	mockConsumeLicenseKey.mockResolvedValue({ ok: true, plan: 'monthly' });
	// #766: startTrial モックのデフォルトは成功
	mockStartTrial.mockReset();
	mockStartTrial.mockResolvedValue(true);
});

/** FormData モック */
function createFormData(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) {
		fd.set(k, v);
	}
	return fd;
}

/** Request モック — user-agent ヘッダも含めて recordConsent 用に再現 */
function createRequest(data: Record<string, string>): Request {
	const fd = createFormData(data);
	return {
		formData: () => Promise.resolve(fd),
		headers: { get: (name: string) => (name === 'user-agent' ? 'test-ua' : null) },
	} as unknown as Request;
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

/**
 * #589: confirm action 用の完全な RequestEvent モックを作成
 * (action は event 全体を受け取り `getClientAddress()` と `authProvider.resolveContext(event, identity)` を呼ぶ)
 */
function createConfirmEvent(formData: Record<string, string>) {
	return {
		request: createRequest(formData),
		cookies: createMockCookies(),
		locals: mockLocals,
		getClientAddress: () => '127.0.0.1',
	};
}

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
	// #589: 自動ログイン成功後に tenant を解決できる状態にするヘルパー
	function setupSuccessfulAutoLogin() {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: true,
			idToken: 'new-id-token',
			accessToken: 'new-access-token',
		});
		mockVerifyIdentityToken.mockResolvedValue({
			sub: 'cognito-user-id-123',
			email: 'test@example.com',
		});
		mockResolveContext.mockResolvedValue({
			tenantId: 'tenant-abc',
			userId: 'cognito-user-id-123',
		});
	}

	it('email/code が空の場合 400 エラーを返し confirmStep を維持', async () => {
		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({ email: '', code: '' });
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.confirm as any)(event);

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
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '000000',
		});
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await (actions.confirm as any)(event);

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('確認コード');
		expect(result.data.email).toBe('test@example.com');
		expect(result.data.confirmStep).toBe(true);
	});

	it('確認成功 + パスワードあり → 自動ログイン + tenant provisioning + consent 記録 → /admin', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}

		// Cookie にトークンがセットされたことを確認
		expect(mockSetIdentityCookie).toHaveBeenCalledWith(event.cookies, 'new-id-token');
		// tenant provisioning が呼ばれる
		expect(mockResolveContext).toHaveBeenCalledWith(
			event,
			expect.objectContaining({
				type: 'cognito',
				userId: 'cognito-user-id-123',
				email: 'test@example.com',
			}),
		);
		// #589 の核心: recordConsent が解決後の tenantId で同期的に呼ばれる
		expect(mockRecordConsent).toHaveBeenCalledWith(
			'tenant-abc',
			'cognito-user-id-123',
			['terms', 'privacy'],
			'127.0.0.1',
			'test-ua',
		);
	});

	it('確認成功 + パスワードなし → /auth/login にリダイレクト（旧フォーム互換）', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}

		// 自動ログインは試みられていない
		expect(mockAuthenticate).not.toHaveBeenCalled();
		// consent 記録も実行されていない
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	it('確認成功 + 自動ログイン失敗 → /auth/login にフォールバック', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: false,
			error: 'UNKNOWN',
			message: 'ログイン失敗',
		});

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}
		expect(mockRecordConsent).not.toHaveBeenCalled();
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
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}
	});

	// #589: 以下はバグ修正の回帰防止テスト
	it('#589: verifyIdentityToken 失敗時 → /auth/login にフォールバック（consent 未記録）', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: true,
			idToken: 'new-id-token',
			accessToken: 'new-access-token',
		});
		mockVerifyIdentityToken.mockResolvedValue(null);

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}

		expect(mockResolveContext).not.toHaveBeenCalled();
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	it('#589: tenant provisioning 失敗時 → /auth/login にフォールバック（consent 未記録）', async () => {
		mockConfirmSignUp.mockResolvedValue({ success: true });
		mockAuthenticate.mockResolvedValue({
			success: true,
			idToken: 'new-id-token',
			accessToken: 'new-access-token',
		});
		mockVerifyIdentityToken.mockResolvedValue({
			sub: 'cognito-user-id-123',
			email: 'test@example.com',
		});
		mockResolveContext.mockResolvedValue(null);

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/auth/login?registered=true');
		}

		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	// Phase 1 補強 3 §3.1: signup の license key 入力経路を削除。
	// entitlement は Stripe Subscription (tenant.status=ACTIVE) が唯一 SSOT のため、
	// confirm action は license key を読まず /admin へ進む。
	it('Phase 1 補強 3: licenseKey フォーム値を渡しても consumeLicenseKey は呼ばれず /admin へ進む', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		// 後方互換: 旧フォーム由来の licenseKey が万一 POST されても無視される
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}

		expect(mockConsumeLicenseKey).not.toHaveBeenCalled();
	});

	// ========================================================
	// #766: /auth/signup?plan=X トライアル自動開始
	// ========================================================
	it('#766: plan=standard 指定時は startTrial が tier=standard で呼ばれる', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'standard',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}

		expect(mockStartTrial).toHaveBeenCalledWith({
			tenantId: 'tenant-abc',
			source: 'user_initiated',
			tier: 'standard',
		});
	});

	it('#766: plan=family 指定時は startTrial が tier=family で呼ばれる', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'family',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}

		expect(mockStartTrial).toHaveBeenCalledWith({
			tenantId: 'tenant-abc',
			source: 'user_initiated',
			tier: 'family',
		});
	});

	it('#766: plan 未指定時は startTrial が呼ばれない', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}

		expect(mockStartTrial).not.toHaveBeenCalled();
	});

	it('#766: 不正な plan パラメータ（free / 無効値 / 大文字小文字ずれ）は無視される', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		// 'free' は有料プランではないのでトライアル対象外
		const event1 = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'free',
		});
		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event1);
			expect.unreachable();
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
		}
		expect(mockStartTrial).not.toHaveBeenCalled();

		mockStartTrial.mockClear();

		// 任意の未知値
		setupSuccessfulAutoLogin();
		const event2 = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'enterprise',
		});
		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event2);
			expect.unreachable();
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
		}
		expect(mockStartTrial).not.toHaveBeenCalled();
	});

	it('#766: plan=STANDARD（大文字）でも小文字に正規化してトライアル開始する', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'STANDARD',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable();
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
		}

		expect(mockStartTrial).toHaveBeenCalledWith({
			tenantId: 'tenant-abc',
			source: 'user_initiated',
			tier: 'standard',
		});
	});

	it('Phase 1 補強 3: licenseKey フォーム値が残っていても plan=standard なら startTrial が呼ばれる（license 優先ロジック撤廃）', async () => {
		setupSuccessfulAutoLogin();

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		// 旧フォーム互換で licenseKey が POST されても無視され、plan に従いトライアル開始
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'standard',
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable();
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
		}

		// license key は読まれず（consumeLicenseKey 不呼出）、plan に従いトライアル開始
		expect(mockConsumeLicenseKey).not.toHaveBeenCalled();
		expect(mockStartTrial).toHaveBeenCalledWith({
			tenantId: 'tenant-abc',
			source: 'user_initiated',
			tier: 'standard',
		});
	});

	it('#766: startTrial が false を返しても（既に使用済み等） /admin に進む', async () => {
		setupSuccessfulAutoLogin();
		mockStartTrial.mockResolvedValue(false);

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'standard',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable();
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}
	});

	it('#766: startTrial が例外を投げても /admin に進む（ログのみで続行）', async () => {
		setupSuccessfulAutoLogin();
		mockStartTrial.mockRejectedValue(new Error('Trial DB unavailable'));

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
			plan: 'family',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable();
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/admin');
		}
	});

	it('#589: recordConsent 失敗時 → /consent に誘導して再同意を促す', async () => {
		setupSuccessfulAutoLogin();
		mockRecordConsent.mockRejectedValue(new Error('DynamoDB unavailable'));

		const { actions } = await import('../../../src/routes/auth/signup/+page.server');
		const event = createConfirmEvent({
			email: 'test@example.com',
			code: '123456',
			password: 'Password1',
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await (actions.confirm as any)(event);
			expect.unreachable('should have thrown redirect');
		} catch (e) {
			expect((e as { status: number }).status).toBe(302);
			expect((e as { location: string }).location).toBe('/consent');
		}

		// tenant は provisioning されているので cookie もセット済み
		expect(mockSetIdentityCookie).toHaveBeenCalled();
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
