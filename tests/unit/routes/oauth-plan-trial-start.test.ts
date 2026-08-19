// tests/unit/routes/oauth-plan-trial-start.test.ts
// #4702: 料金ページ「無料体験をはじめる」→ /auth/signup?plan=X で **Google 登録**した顧客にも
// メール登録経路と同じトライアル自動開始を適用する経路の検証。
//
// 経路: /auth/oauth/google?plan=X (cookie 保存) → Cognito → /auth/callback (plan cookie あれば
// trial-start 経由に切替) → /auth/oauth/trial-start (テナント解決済み → startTrial → 本来の着地先)。
// 「plan を渡す側」と「trial を開始する側」が別 route に分かれるため、cookie の受け渡しと
// 冪等性 (cookie 1 回限り) を固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBuildAuthorizeUrl = vi.fn(() => 'https://cognito.example.com/authorize');
const mockExchangeCodeForTokens = vi.fn();
const mockVerifyOAuthState = vi.fn();
const mockStartTrial = vi.fn();

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
vi.mock('$lib/server/services/trial-service', () => ({
	startTrial: mockStartTrial,
}));

const { GET: googleStartGET } = await import('../../../src/routes/auth/oauth/google/+server');
const { GET: callbackGET } = await import('../../../src/routes/auth/callback/+server');
const { GET: trialStartGET } = await import('../../../src/routes/auth/oauth/trial-start/+server');

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

/** cookie jar (get / set / delete) を持つ最小の Cookies モック */
function makeCookieJar(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	return {
		jar,
		cookies: {
			get: (name: string) => jar.get(name),
			set: vi.fn((name: string, value: string) => {
				jar.set(name, value);
			}),
			delete: vi.fn((name: string) => {
				jar.delete(name);
			}),
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockStartTrial.mockResolvedValue(true);
});

describe('GET /auth/oauth/google — ?plan= の受け渡し (#4702)', () => {
	it.each([
		'standard',
		'family',
	])('有効な plan=%s は oauth_plan cookie に保存される', async (plan) => {
		const { cookies, jar } = makeCookieJar();
		await getRedirectLocation(() =>
			googleStartGET({
				cookies,
				url: new URL(`http://localhost/auth/oauth/google?plan=${plan}`),
			} as never),
		);
		expect(jar.get('oauth_plan')).toBe(plan);
	});

	it('無効な plan (free / 空) は保存しない', async () => {
		for (const plan of ['free', '']) {
			const { cookies, jar } = makeCookieJar();
			await getRedirectLocation(() =>
				googleStartGET({
					cookies,
					url: new URL(`http://localhost/auth/oauth/google?plan=${plan}`),
				} as never),
			);
			expect(jar.has('oauth_plan')).toBe(false);
		}
	});
});

describe('GET /auth/callback — plan cookie があれば trial-start を経由する (#4702)', () => {
	function makeCallbackEvent(cookieJar: ReturnType<typeof makeCookieJar>) {
		return {
			cookies: cookieJar.cookies,
			url: new URL('http://localhost/auth/callback?code=c&state=s'),
		} as never;
	}

	it('plan cookie ありは /auth/oauth/trial-start?next=<本来の着地先> へ', async () => {
		mockVerifyOAuthState.mockReturnValue(true);
		mockExchangeCodeForTokens.mockResolvedValue({ idToken: 'id', refreshToken: 'r' });
		const jar = makeCookieJar({ oauth_plan: 'standard', oauth_next: '/marketplace/checklist/x' });
		const location = await getRedirectLocation(() => callbackGET(makeCallbackEvent(jar)));
		expect(location).toBe(
			`/auth/oauth/trial-start?next=${encodeURIComponent('/marketplace/checklist/x')}`,
		);
	});

	it('plan cookie なしは従来どおり直接着地する (回帰)', async () => {
		mockVerifyOAuthState.mockReturnValue(true);
		mockExchangeCodeForTokens.mockResolvedValue({ idToken: 'id', refreshToken: 'r' });
		const jar = makeCookieJar({});
		const location = await getRedirectLocation(() => callbackGET(makeCallbackEvent(jar)));
		expect(location).toBe('/admin');
	});
});

describe('GET /auth/oauth/trial-start (#4702)', () => {
	function makeEvent(
		cookieJar: ReturnType<typeof makeCookieJar>,
		opts: { tenantId?: string | null; next?: string } = {},
	) {
		const search = opts.next ? `?next=${encodeURIComponent(opts.next)}` : '';
		return {
			cookies: cookieJar.cookies,
			locals: opts.tenantId === null ? {} : { context: { tenantId: opts.tenantId ?? 't-1' } },
			url: new URL(`http://localhost/auth/oauth/trial-start${search}`),
		} as never;
	}

	it('plan cookie + テナントありで startTrial を呼び、着地先へ redirect する', async () => {
		const jar = makeCookieJar({ oauth_plan: 'family' });
		const location = await getRedirectLocation(() =>
			trialStartGET(makeEvent(jar, { next: '/admin/subscription' })),
		);
		expect(mockStartTrial).toHaveBeenCalledWith({
			tenantId: 't-1',
			source: 'user_initiated',
			tier: 'family',
		});
		expect(location).toBe('/admin/subscription');
	});

	it('cookie は 1 回限り (再訪でトライアルを二重開始しない)', async () => {
		const jar = makeCookieJar({ oauth_plan: 'standard' });
		await getRedirectLocation(() => trialStartGET(makeEvent(jar)));
		expect(jar.jar.has('oauth_plan')).toBe(false);

		mockStartTrial.mockClear();
		await getRedirectLocation(() => trialStartGET(makeEvent(jar)));
		expect(mockStartTrial).not.toHaveBeenCalled();
	});

	it('テナント未解決 / plan 無効なら startTrial を呼ばず /admin へ (dead-end を作らない)', async () => {
		const noTenant = makeCookieJar({ oauth_plan: 'standard' });
		expect(
			await getRedirectLocation(() => trialStartGET(makeEvent(noTenant, { tenantId: null }))),
		).toBe('/admin');

		const badPlan = makeCookieJar({ oauth_plan: 'free' });
		expect(await getRedirectLocation(() => trialStartGET(makeEvent(badPlan)))).toBe('/admin');
		expect(mockStartTrial).not.toHaveBeenCalled();
	});

	it('startTrial が throw しても着地は妨げない (best-effort)', async () => {
		mockStartTrial.mockRejectedValue(new Error('boom'));
		const jar = makeCookieJar({ oauth_plan: 'standard' });
		expect(await getRedirectLocation(() => trialStartGET(makeEvent(jar)))).toBe('/admin');
	});

	it('next が外部 URL なら無視して /admin (open redirect 防止、login-redirect SSOT 経由)', async () => {
		const jar = makeCookieJar({ oauth_plan: 'standard' });
		const location = await getRedirectLocation(() =>
			trialStartGET(makeEvent(jar, { next: 'https://evil.com/x' })),
		);
		expect(location).toBe('/admin');
	});
});
