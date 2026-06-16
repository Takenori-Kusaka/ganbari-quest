// tests/unit/routes/oauth-next-open-redirect.test.ts
// #3025 QM adversarial 指摘: next / oauth_next の内部 path 検証の open-redirect バイパス封鎖
//
// 旧 regex /^\/(?!\/)/ は "//evil.com" は弾くが "/\evil.com" を通していた。
// ブラウザは Location ヘッダの "\" を "/" に正規化するため、"/\evil.com" は
// protocol-relative "//evil.com" として外部サイトへ遷移し得る (open redirect)。
// 修正後 regex /^\/(?![/\\])/ は先頭 "/" の直後に "/" と "\" の両方を拒否する。
//
// 検証対象:
// - src/routes/auth/oauth/google/+server.ts (next query → oauth_next cookie 保存ガード)
// - src/routes/auth/callback/+server.ts (oauth_next cookie → successPath 採用ガード)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBuildAuthorizeUrl = vi.fn(() => 'https://cognito.example.com/authorize');
const mockExchangeCodeForTokens = vi.fn();
const mockVerifyOAuthState = vi.fn();

vi.mock('$lib/server/auth/providers/cognito-oauth', () => ({
	buildAuthorizeUrl: mockBuildAuthorizeUrl,
	exchangeCodeForTokens: mockExchangeCodeForTokens,
	setIdentityCookie: vi.fn(),
	setRefreshCookie: vi.fn(),
	verifyOAuthState: mockVerifyOAuthState,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { GET: googleStartGET } = await import('../../../src/routes/auth/oauth/google/+server');
const { GET: callbackGET } = await import('../../../src/routes/auth/callback/+server');

// redirect() は throw するため、location を取り出すヘルパ
async function getRedirectLocation(fn: () => unknown): Promise<string> {
	try {
		await fn();
	} catch (e) {
		const redirect = e as { status?: number; location?: string };
		if (typeof redirect.location === 'string') return redirect.location;
		throw e;
	}
	throw new Error('redirect が throw されなかった');
}

describe('#3025 GET /auth/oauth/google — next の open-redirect ガード', () => {
	function makeStartEvent(next: string) {
		const cookieSet = vi.fn();
		return {
			event: {
				cookies: { set: cookieSet },
				url: new URL(`http://localhost/auth/oauth/google?next=${encodeURIComponent(next)}`),
			} as unknown as Parameters<typeof googleStartGET>[0],
			cookieSet,
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('内部 path (/auth/reset-pin) は oauth_next cookie に保存される', async () => {
		const { event, cookieSet } = makeStartEvent('/auth/reset-pin');
		await getRedirectLocation(() => googleStartGET(event));
		expect(cookieSet).toHaveBeenCalledWith('oauth_next', '/auth/reset-pin', expect.any(Object));
	});

	it('"//evil.com" (protocol-relative) は保存しない', async () => {
		const { event, cookieSet } = makeStartEvent('//evil.com');
		await getRedirectLocation(() => googleStartGET(event));
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it('"/\\evil.com" (backslash 正規化バイパス) は保存しない', async () => {
		// ブラウザは Location の "\" を "/" に正規化するため "//evil.com" 同等の外部遷移になる
		const { event, cookieSet } = makeStartEvent('/\\evil.com');
		await getRedirectLocation(() => googleStartGET(event));
		expect(cookieSet).not.toHaveBeenCalled();
	});
});

describe('#3025 GET /auth/callback — oauth_next の open-redirect ガード', () => {
	function makeCallbackEvent(oauthNext: string) {
		return {
			url: new URL('http://localhost/auth/callback?code=test-code&state=test-state'),
			cookies: {
				get: vi.fn((name: string) => (name === 'oauth_next' ? oauthNext : undefined)),
				set: vi.fn(),
				delete: vi.fn(),
			},
		} as unknown as Parameters<typeof callbackGET>[0];
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockVerifyOAuthState.mockReturnValue(true);
		mockExchangeCodeForTokens.mockResolvedValue({
			idToken: 'id-token',
			refreshToken: 'refresh-token',
		});
	});

	it('oauth_next が内部 path なら遷移先に採用される', async () => {
		const location = await getRedirectLocation(() =>
			callbackGET(makeCallbackEvent('/auth/reset-pin')),
		);
		expect(location).toBe('/auth/reset-pin');
	});

	it('oauth_next が "//evil.com" なら /admin に fallback する', async () => {
		const location = await getRedirectLocation(() => callbackGET(makeCallbackEvent('//evil.com')));
		expect(location).toBe('/admin');
	});

	it('oauth_next が "/\\evil.com" (backslash 正規化バイパス) なら /admin に fallback する', async () => {
		const location = await getRedirectLocation(() => callbackGET(makeCallbackEvent('/\\evil.com')));
		expect(location).toBe('/admin');
	});
});
