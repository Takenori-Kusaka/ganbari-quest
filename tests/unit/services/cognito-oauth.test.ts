// tests/unit/services/cognito-oauth.test.ts
// Cognito OAuth ヘルパーのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 環境変数を先にセット（モジュール読み込み前に必要）
beforeEach(() => {
	process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool';
	process.env.COGNITO_CLIENT_ID = 'test-client-id';
	process.env.COGNITO_CLIENT_SECRET = 'test-client-secret';
	process.env.COGNITO_DOMAIN = 'test.auth.us-east-1.amazoncognito.com';
	process.env.COGNITO_CALLBACK_URL = 'http://localhost:5173/auth/callback';
	process.env.COGNITO_LOGOUT_URL = 'http://localhost:5173/login';
	process.env.NODE_ENV = 'test';
});

afterEach(() => {
	process.env.COGNITO_USER_POOL_ID = undefined;
	process.env.COGNITO_CLIENT_ID = undefined;
	process.env.COGNITO_CLIENT_SECRET = undefined;
	process.env.COGNITO_DOMAIN = undefined;
	process.env.COGNITO_CALLBACK_URL = undefined;
	process.env.COGNITO_LOGOUT_URL = undefined;
	vi.restoreAllMocks();
});

/** Cookie モック */
function createMockCookies() {
	const store = new Map<string, string>();
	return {
		get: (name: string) => store.get(name),
		set: (name: string, value: string, _opts?: unknown) => {
			store.set(name, value);
		},
		delete: (name: string, _opts?: unknown) => {
			store.delete(name);
		},
		_store: store,
	};
}

describe('cognito-oauth', () => {
	describe('getCognitoOAuthConfig', () => {
		it('環境変数から設定を取得する', async () => {
			const { getCognitoOAuthConfig } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const config = getCognitoOAuthConfig();
			expect(config.userPoolId).toBe('us-east-1_TestPool');
			expect(config.clientId).toBe('test-client-id');
			expect(config.clientSecret).toBe('test-client-secret');
			expect(config.domain).toBe('test.auth.us-east-1.amazoncognito.com');
			expect(config.callbackUrl).toBe('http://localhost:5173/auth/callback');
		});

		it('COGNITO_USER_POOL_ID が未設定でエラー', async () => {
			process.env.COGNITO_USER_POOL_ID = '';
			const { getCognitoOAuthConfig } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			expect(() => getCognitoOAuthConfig()).toThrow('COGNITO_USER_POOL_ID');
		});
	});

	describe('buildAuthorizeUrl', () => {
		it('正しい認可 URL を生成する', async () => {
			const { buildAuthorizeUrl } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const url = buildAuthorizeUrl(cookies as any);

			expect(url).toContain('https://test.auth.us-east-1.amazoncognito.com/oauth2/authorize');
			expect(url).toContain('response_type=code');
			expect(url).toContain('client_id=test-client-id');
			expect(url).toContain('redirect_uri=');
			expect(url).toContain('scope=openid+email+profile');
			expect(url).toContain('state=');
			expect(url).toContain('nonce=');
		});

		it('state と nonce が Cookie に保存される', async () => {
			const { buildAuthorizeUrl } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			buildAuthorizeUrl(cookies as any);

			expect(cookies._store.has('oauth_state')).toBe(true);
			expect(cookies._store.has('oauth_nonce')).toBe(true);
			expect(cookies._store.get('oauth_state')?.length).toBeGreaterThan(0);
		});
	});

	describe('verifyOAuthState', () => {
		it('一致する state で true を返す', async () => {
			const { verifyOAuthState } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();
			cookies.set('oauth_state', 'test-state-123');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			expect(verifyOAuthState('test-state-123', cookies as any)).toBe(true);
		});

		it('不一致の state で false を返す', async () => {
			const { verifyOAuthState } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();
			cookies.set('oauth_state', 'correct-state');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			expect(verifyOAuthState('wrong-state', cookies as any)).toBe(false);
		});

		it('Cookie がない場合 false を返す', async () => {
			const { verifyOAuthState } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			expect(verifyOAuthState('any-state', cookies as any)).toBe(false);
		});
	});

	describe('buildLogoutUrl', () => {
		it('正しいログアウト URL を生成する', async () => {
			const { buildLogoutUrl } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const url = buildLogoutUrl();

			expect(url).toContain('https://test.auth.us-east-1.amazoncognito.com/logout');
			expect(url).toContain('client_id=test-client-id');
			expect(url).toContain('logout_uri=');
		});
	});

	describe('exchangeCodeForTokens', () => {
		it('正常なトークン交換', async () => {
			const mockResponse = {
				ok: true,
				json: async () => ({
					id_token: 'mock-id-token',
					access_token: 'mock-access-token',
					refresh_token: 'mock-refresh-token',
				}),
			};
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

			const { exchangeCodeForTokens } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();
			cookies.set('oauth_state', 'test-state');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const tokens = await exchangeCodeForTokens('auth-code-123', cookies as any);

			expect(tokens.idToken).toBe('mock-id-token');
			expect(tokens.accessToken).toBe('mock-access-token');
			expect(tokens.refreshToken).toBe('mock-refresh-token');
		});

		it('state Cookie がない場合エラー', async () => {
			const { exchangeCodeForTokens } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();
			// state Cookie を設定しない

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await expect(exchangeCodeForTokens('code', cookies as any)).rejects.toThrow(
				'OAuth state cookie not found',
			);
		});

		it('トークンエンドポイントがエラーを返した場合', async () => {
			const mockResponse = {
				ok: false,
				status: 400,
				text: async () => '{"error":"invalid_grant"}',
			};
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

			const { exchangeCodeForTokens } = await import(
				'../../../src/lib/server/auth/providers/cognito-oauth'
			);
			const cookies = createMockCookies();
			cookies.set('oauth_state', 'test-state');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await expect(exchangeCodeForTokens('bad-code', cookies as any)).rejects.toThrow(
				'Token exchange failed: 400',
			);
		});
	});
});
