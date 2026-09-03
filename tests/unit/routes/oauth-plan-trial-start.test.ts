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
// #4702 (QM #4748): callback は「このログインで初めてアカウントが作られる」ときだけ trial-start へ回す。
// 本 file は plan cookie の往復と trial-start 本体を見るため、identity あり + 既存アカウント無しで固定する。
vi.mock('$lib/server/auth/factory', () => ({
	getAuthProvider: () => ({
		resolveIdentity: vi.fn(async () => ({
			type: 'cognito',
			userId: 'sub-1',
			email: 'new-parent@example.com',
			role: 'owner',
		})),
	}),
}));
vi.mock('$lib/server/auth/post-login-landing', () => ({
	resolvePostLoginLanding: vi.fn(async (_e: unknown, _i: unknown, path: string) => path),
}));
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: { findUserByEmail: vi.fn(async () => null) } }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('$lib/server/services/trial-service', () => ({
	startTrial: mockStartTrial,
	// #4501: tier は呼び出し側が選ばず、この定数で固定される (FR-2 premium 固定)。
	// 'family' は DB / 内部 tier コードに残る旧名で、顧客向け表示名が 'premium'。
	TRIAL_TIER: 'family',
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
	// #4501: cookie には parseSignupPlanParam の**正規化後**の値が入る
	// (旧 alias 'family' は 'premium' に寄せられる)。生値をそのまま保存すると
	// trial-start 側が二重に値域を持つことになるため、ここで正規化を固定する。
	it.each([
		['standard', 'standard'],
		['premium', 'premium'],
		['family', 'premium'],
	])('有効な plan=%s は oauth_plan cookie に %s として保存される', async (plan, stored) => {
		const { cookies, jar } = makeCookieJar();
		await getRedirectLocation(() =>
			googleStartGET({
				cookies,
				url: new URL(`http://localhost/auth/oauth/google?plan=${plan}`),
			} as never),
		);
		expect(jar.get('oauth_plan')).toBe(stored);
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
			locals:
				opts.tenantId === null
					? {}
					: { context: { tenantId: opts.tenantId ?? 't-1', role: 'owner' } },
			url: new URL(`http://localhost/auth/oauth/trial-start${search}`),
		} as never;
	}

	it('plan cookie + テナントありで startTrial を呼び、着地先へ redirect する', async () => {
		// cookie には google route が書いた正規化後の値が入る (#4501)
		const jar = makeCookieJar({ oauth_plan: 'premium' });
		const location = await getRedirectLocation(() =>
			trialStartGET(makeEvent(jar, { next: '/admin/subscription' })),
		);
		// tier は cookie の plan ではなく TRIAL_TIER 固定 (#4501 FR-2)。
		// 'family' は premium の内部 tier コード。
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

	it('テナント未解決のときは cookie を残し、次の機会に再試行できる (#4702 QM)', async () => {
		// hooks のテナント自動プロビジョニングが初回リクエストで間に合わない / 失敗する場合。
		// ここで cookie を捨てると「無料体験をはじめる」を押した顧客のトライアルが
		// 再試行不能なまま永久に失われる (顧客にもサポートにも見えない)。
		const jar = makeCookieJar({ oauth_plan: 'standard' });
		expect(await getRedirectLocation(() => trialStartGET(makeEvent(jar, { tenantId: null })))).toBe(
			'/admin',
		);
		expect(mockStartTrial).not.toHaveBeenCalled();
		expect(jar.jar.has('oauth_plan'), 'cookie を残して再試行可能にする').toBe(true);

		// テナントが解決できた次の機会に、同じ cookie で開始できる
		expect(await getRedirectLocation(() => trialStartGET(makeEvent(jar)))).toBe('/admin');
		expect(mockStartTrial).toHaveBeenCalledTimes(1);
		expect(jar.jar.has('oauth_plan'), '開始を試みたら cookie は落とす').toBe(false);
	});

	it('plan が無効なら cookie を落とす (再試行しても意味が無い)', async () => {
		const jar = makeCookieJar({ oauth_plan: 'free' });
		expect(await getRedirectLocation(() => trialStartGET(makeEvent(jar)))).toBe('/admin');
		expect(mockStartTrial).not.toHaveBeenCalled();
		expect(jar.jar.has('oauth_plan')).toBe(false);
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
