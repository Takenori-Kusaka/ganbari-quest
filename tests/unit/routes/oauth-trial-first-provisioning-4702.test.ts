// tests/unit/routes/oauth-trial-first-provisioning-4702.test.ts
//
// #4702 PO 判断「callback の初回 provisioning 後にメール経路と同じ startTrial を呼ぶ」の
// 「初回 provisioning のときだけ」を固定する (QM #4748 adversarial 指摘)。
//
// - 既存アカウント (再訪者 / 招待で合流済みの parent / Google 連携の child) が ?plan= 付きで
//   Google ログインしても、世帯の 1 回限りのトライアルを消費しない
// - /auth 配下は全ロール allowed なので、trial-start は owner 以外を弾く (二重防御)
// - callback の失敗分岐で oauth_plan cookie を残さない (10 分残ると別アカウントで発火する)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyOAuthState = vi.fn();
const mockExchangeCodeForTokens = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-oauth', () => ({
	buildAuthorizeUrl: vi.fn(() => 'https://cognito.example.com/authorize'),
	exchangeCodeForTokens: mockExchangeCodeForTokens,
	setIdentityCookie: vi.fn(),
	setRefreshCookie: vi.fn(),
	verifyOAuthState: mockVerifyOAuthState,
}));

const mockResolveIdentity = vi.fn();
vi.mock('$lib/server/auth/factory', () => ({
	getAuthProvider: () => ({ resolveIdentity: mockResolveIdentity }),
}));

// 実物の resolvePostLoginLanding → resolveContext は初回ログインで users 行 / テナントを **作る**。
// その副作用を mock でも再現し (landing 解決後は findUserByEmail が行を返す)、
// 「初回 provisioning 判定を landing より前に評価する」順序契約を固定する (adv-4748 再検証の must)。
let provisionedByLanding = false;
vi.mock('$lib/server/auth/post-login-landing', () => ({
	resolvePostLoginLanding: vi.fn(async () => {
		provisionedByLanding = true;
		return '/admin';
	}),
}));

const mockFindUserByEmail = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: { findUserByEmail: mockFindUserByEmail } }),
}));

const mockStartTrial = vi.fn();
vi.mock('$lib/server/services/trial-service', () => ({
	startTrial: mockStartTrial,
	TRIAL_TIER: 'family',
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

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

const IDENTITY = { type: 'cognito', userId: 'sub-1', email: 'parent@example.com', role: 'owner' };

function makeCallbackEvent(opts: { planCookie?: string; query?: string } = {}) {
	const cookieDelete = vi.fn();
	const event = {
		url: new URL(
			`http://localhost/auth/callback?${opts.query ?? 'code=test-code&state=test-state'}`,
		),
		cookies: {
			get: vi.fn((name: string) => (name === 'oauth_plan' ? opts.planCookie : undefined)),
			set: vi.fn(),
			delete: cookieDelete,
		},
	} as unknown as Parameters<typeof callbackGET>[0];
	return { event, cookieDelete };
}

function makeTrialStartEvent(opts: { role?: string; tenantId?: string; planCookie?: string }) {
	const cookieDelete = vi.fn();
	const event = {
		url: new URL('http://localhost/auth/oauth/trial-start?next=%2Fadmin'),
		cookies: {
			get: vi.fn((name: string) => (name === 'oauth_plan' ? opts.planCookie : undefined)),
			delete: cookieDelete,
		},
		locals: { context: { tenantId: opts.tenantId, role: opts.role } },
	} as unknown as Parameters<typeof trialStartGET>[0];
	return { event, cookieDelete };
}

describe('#4702 GET /auth/callback — トライアル自動開始は初回 provisioning のときだけ', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		provisionedByLanding = false;
		mockVerifyOAuthState.mockReturnValue(true);
		mockExchangeCodeForTokens.mockResolvedValue({
			idToken: 'id-token',
			refreshToken: 'refresh-token',
		});
		mockResolveIdentity.mockResolvedValue(IDENTITY);
	});

	it('アカウントが無い email (初回 provisioning) なら trial-start へ回す — landing 解決 (provisioning) の後に users 行が出来ても判定は変わらない', async () => {
		// landing 解決前は行なし、解決後は「今作られた行」が返る (実物の挙動)
		mockFindUserByEmail.mockImplementation(async () =>
			provisionedByLanding ? { userId: 'u-new', email: 'parent@example.com' } : null,
		);
		const { event, cookieDelete } = makeCallbackEvent({ planCookie: 'standard' });
		const location = await getRedirectLocation(() => callbackGET(event));
		expect(location).toMatch(/^\/auth\/oauth\/trial-start\?next=/);
		expect(cookieDelete).not.toHaveBeenCalledWith('oauth_plan', expect.anything());
	});

	it('既存アカウントの Google ログインでは trial-start へ回さず cookie を落とす (世帯 trial を消費しない)', async () => {
		mockFindUserByEmail.mockResolvedValue({ userId: 'u-1', email: 'parent@example.com' });
		const { event, cookieDelete } = makeCallbackEvent({ planCookie: 'standard' });
		const location = await getRedirectLocation(() => callbackGET(event));
		expect(location).toBe('/admin');
		expect(cookieDelete).toHaveBeenCalledWith('oauth_plan', { path: '/' });
	});

	it('既存か判定できない (DB 障害) ときは fail-closed で trial-start へ回さない', async () => {
		mockFindUserByEmail.mockRejectedValue(new Error('db down'));
		const { event, cookieDelete } = makeCallbackEvent({ planCookie: 'standard' });
		const location = await getRedirectLocation(() => callbackGET(event));
		expect(location).toBe('/admin');
		expect(cookieDelete).toHaveBeenCalledWith('oauth_plan', { path: '/' });
	});

	it('identity が解決できないときも trial-start へ回さない', async () => {
		mockResolveIdentity.mockResolvedValue(null);
		mockFindUserByEmail.mockResolvedValue(null);
		const { event, cookieDelete } = makeCallbackEvent({ planCookie: 'standard' });
		const location = await getRedirectLocation(() => callbackGET(event));
		expect(location).toBe('/admin');
		expect(cookieDelete).toHaveBeenCalledWith('oauth_plan', { path: '/' });
		expect(mockFindUserByEmail).not.toHaveBeenCalled();
	});

	it('plan cookie が無ければ従来どおり着地先へ (lookup も走らない)', async () => {
		const { event } = makeCallbackEvent({});
		const location = await getRedirectLocation(() => callbackGET(event));
		expect(location).toBe('/admin');
		expect(mockFindUserByEmail).not.toHaveBeenCalled();
	});

	it('OAuth エラー / state 不一致の失敗分岐でも plan cookie を残さない', async () => {
		const failed = makeCallbackEvent({ planCookie: 'standard', query: 'error=access_denied' });
		await getRedirectLocation(() => callbackGET(failed.event));
		expect(failed.cookieDelete).toHaveBeenCalledWith('oauth_plan', { path: '/' });

		mockVerifyOAuthState.mockReturnValue(false);
		const badState = makeCallbackEvent({ planCookie: 'standard' });
		await getRedirectLocation(() => callbackGET(badState.event));
		expect(badState.cookieDelete).toHaveBeenCalledWith('oauth_plan', { path: '/' });
	});
});

describe('#4702 GET /auth/oauth/trial-start — owner 以外は世帯 trial を開始できない', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStartTrial.mockResolvedValue(true);
	});

	it('owner は startTrial が呼ばれ、cookie は落ちる', async () => {
		const { event, cookieDelete } = makeTrialStartEvent({
			role: 'owner',
			tenantId: 't-1',
			planCookie: 'standard',
		});
		const location = await getRedirectLocation(() => trialStartGET(event));
		expect(location).toBe('/admin');
		expect(mockStartTrial).toHaveBeenCalledWith(
			expect.objectContaining({ tenantId: 't-1', source: 'user_initiated' }),
		);
		expect(cookieDelete).toHaveBeenCalledWith('oauth_plan', { path: '/' });
	});

	it.each([
		'child',
		'parent',
		undefined,
	])('role=%s は startTrial を呼ばず cookie を落とす', async (role) => {
		const { event, cookieDelete } = makeTrialStartEvent({
			role,
			tenantId: 't-1',
			planCookie: 'standard',
		});
		const location = await getRedirectLocation(() => trialStartGET(event));
		expect(location).toBe('/admin');
		expect(mockStartTrial).not.toHaveBeenCalled();
		expect(cookieDelete).toHaveBeenCalledWith('oauth_plan', { path: '/' });
	});

	it('tenant 未解決のときは cookie を残して再試行できる (既存契約 #4702 QM)', async () => {
		const { event, cookieDelete } = makeTrialStartEvent({
			role: undefined,
			planCookie: 'standard',
		});
		await getRedirectLocation(() => trialStartGET(event));
		expect(mockStartTrial).not.toHaveBeenCalled();
		expect(cookieDelete).not.toHaveBeenCalled();
	});
});
