// tests/unit/services/cognito-oauth.test.ts
// Cognito OAuth ヘルパーのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// static import — vi.mock はホイストされるため安全
// 各関数は呼び出し時に process.env を参照するため beforeEach での設定が有効
import {
	buildAuthorizeUrl,
	buildLogoutUrl,
	clearRefreshCookie,
	exchangeCodeForTokens,
	getCognitoOAuthConfig,
	refreshCognitoIdToken,
	revokeCognitoRefreshToken,
	setRefreshCookie,
	verifyOAuthState,
} from '../../../src/lib/server/auth/providers/cognito-oauth';

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
		it('環境変数から設定を取得する', () => {
			const config = getCognitoOAuthConfig();
			expect(config.userPoolId).toBe('us-east-1_TestPool');
			expect(config.clientId).toBe('test-client-id');
			expect(config.clientSecret).toBe('test-client-secret');
			expect(config.domain).toBe('test.auth.us-east-1.amazoncognito.com');
			expect(config.callbackUrl).toBe('http://localhost:5173/auth/callback');
		});

		it('COGNITO_USER_POOL_ID が未設定でエラー', () => {
			process.env.COGNITO_USER_POOL_ID = '';
			expect(() => getCognitoOAuthConfig()).toThrow('COGNITO_USER_POOL_ID');
		});
	});

	describe('buildAuthorizeUrl', () => {
		it('正しい認可 URL を生成する', () => {
			const cookies = createMockCookies();
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const url = buildAuthorizeUrl(cookies as any);

			expect(url).toContain('https://test.auth.us-east-1.amazoncognito.com/oauth2/authorize');
			expect(url).toContain('response_type=code');
			expect(url).toContain('client_id=test-client-id');
			expect(url).toContain('redirect_uri=');
			expect(url).toContain('scope=openid+email');
			expect(url).toContain('state=');
			expect(url).toContain('nonce=');
		});

		it('state と nonce が Cookie に保存される', () => {
			const cookies = createMockCookies();
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			buildAuthorizeUrl(cookies as any);

			expect(cookies._store.has('oauth_state')).toBe(true);
			expect(cookies._store.has('oauth_nonce')).toBe(true);
			expect(cookies._store.get('oauth_state')?.length).toBeGreaterThan(0);
		});
	});

	describe('verifyOAuthState', () => {
		it('一致する state で true を返す', () => {
			const cookies = createMockCookies();
			cookies.set('oauth_state', 'test-state-123');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			expect(verifyOAuthState('test-state-123', cookies as any)).toBe(true);
		});

		it('不一致の state で false を返す', () => {
			const cookies = createMockCookies();
			cookies.set('oauth_state', 'correct-state');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			expect(verifyOAuthState('wrong-state', cookies as any)).toBe(false);
		});

		it('Cookie がない場合 false を返す', () => {
			const cookies = createMockCookies();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			expect(verifyOAuthState('any-state', cookies as any)).toBe(false);
		});
	});

	describe('buildLogoutUrl', () => {
		it('正しいログアウト URL を生成する', () => {
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

			const cookies = createMockCookies();
			cookies.set('oauth_state', 'test-state');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const tokens = await exchangeCodeForTokens('auth-code-123', cookies as any);

			expect(tokens.idToken).toBe('mock-id-token');
			expect(tokens.accessToken).toBe('mock-access-token');
			expect(tokens.refreshToken).toBe('mock-refresh-token');
		});

		it('state Cookie がない場合エラー', async () => {
			const cookies = createMockCookies();

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

			const cookies = createMockCookies();
			cookies.set('oauth_state', 'test-state');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await expect(exchangeCodeForTokens('bad-code', cookies as any)).rejects.toThrow(
				'Token exchange failed: 400',
			);
		});
	});

	describe('setRefreshCookie / clearRefreshCookie', () => {
		it('Refresh Token を Cookie に設定する', () => {
			const cookies = createMockCookies();
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			setRefreshCookie(cookies as any, 'refresh-token-value');
			expect(cookies._store.get('gq_refresh')).toBe('refresh-token-value');
		});

		it('clearRefreshCookie で Cookie を削除する', () => {
			const cookies = createMockCookies();
			cookies.set('gq_refresh', 'some-refresh-token');
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			clearRefreshCookie(cookies as any);
			expect(cookies._store.has('gq_refresh')).toBe(false);
		});
	});

	describe('refreshCognitoIdToken', () => {
		it('Refresh Token がない場合 null を返す', async () => {
			const cookies = createMockCookies();
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const result = await refreshCognitoIdToken(cookies as any);
			expect(result).toBeNull();
		});

		it('正常なリフレッシュで新しい ID Token を返す', async () => {
			const mockResponse = {
				ok: true,
				json: async () => ({
					id_token: 'new-id-token',
					access_token: 'new-access-token',
				}),
			};
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

			const cookies = createMockCookies();
			cookies.set('gq_refresh', 'valid-refresh-token');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const result = await refreshCognitoIdToken(cookies as any);

			expect(result).not.toBeNull();
			expect(result?.idToken).toBe('new-id-token');
			// identity_token Cookie が更新されること
			expect(cookies._store.get('identity_token')).toBe('new-id-token');
		});

		it('Cognito がリフレッシュトークンをローテーションした場合は更新する', async () => {
			const mockResponse = {
				ok: true,
				json: async () => ({
					id_token: 'new-id-token',
					access_token: 'new-access-token',
					refresh_token: 'rotated-refresh-token',
				}),
			};
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

			const cookies = createMockCookies();
			cookies.set('gq_refresh', 'old-refresh-token');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await refreshCognitoIdToken(cookies as any);

			expect(cookies._store.get('gq_refresh')).toBe('rotated-refresh-token');
		});

		it('トークンエンドポイントがエラーを返した場合 null を返して Refresh Cookie を削除する', async () => {
			const mockResponse = {
				ok: false,
				status: 400,
				json: async () => ({ error: 'invalid_grant' }),
			};
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

			const cookies = createMockCookies();
			cookies.set('gq_refresh', 'expired-refresh-token');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const result = await refreshCognitoIdToken(cookies as any);

			expect(result).toBeNull();
			expect(cookies._store.has('gq_refresh')).toBe(false);
		});
	});

	describe('revokeCognitoRefreshToken', () => {
		it('Refresh Token が存在する場合 revoke エンドポイントを呼び出す', async () => {
			const fetchMock = vi.fn().mockResolvedValue({ ok: true });
			vi.stubGlobal('fetch', fetchMock);

			const cookies = createMockCookies();
			cookies.set('gq_refresh', 'valid-refresh-token');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await revokeCognitoRefreshToken(cookies as any);

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, opts] = fetchMock.mock.calls[0];
			expect(url).toContain('/oauth2/revoke');
			expect(opts.method).toBe('POST');
		});

		it('Refresh Token が存在しない場合 fetch を呼び出さない', async () => {
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);

			const cookies = createMockCookies();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await revokeCognitoRefreshToken(cookies as any);

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('revoke エンドポイントがエラーを返しても例外を投げない（warn ログのみ）', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

			const cookies = createMockCookies();
			cookies.set('gq_refresh', 'invalid-token');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await expect(revokeCognitoRefreshToken(cookies as any)).resolves.not.toThrow();
		});

		it('fetch 自体が失敗しても例外を投げない（warn ログのみ）', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

			const cookies = createMockCookies();
			cookies.set('gq_refresh', 'some-token');

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await expect(revokeCognitoRefreshToken(cookies as any)).resolves.not.toThrow();
		});
	});
});
