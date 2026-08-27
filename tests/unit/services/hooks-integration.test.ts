// tests/unit/services/hooks-integration.test.ts
// hooks.server.ts の結合テスト (#0123: Identity型変更、PIN廃止)

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// --- モック定義 ---
// hooks.server.ts の全依存をモック化し、並列実行時の深いモジュール解決を回避する

const mockIsSetupRequired = vi.fn();
vi.mock('$lib/server/services/setup-service', () => ({
	isSetupRequired: () => mockIsSetupRequired(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		request: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	checkApiRateLimit: () => ({ allowed: true, remaining: 99, resetAt: Date.now() + 60000 }),
	checkAuthRateLimit: (method?: string) => {
		const isGet = method?.toUpperCase() === 'GET' || method?.toUpperCase() === 'HEAD';
		return { allowed: true, remaining: isGet ? 59 : 29, resetAt: Date.now() + 60000 };
	},
}));

const mockCheckConsent = vi.fn();
vi.mock('$lib/server/services/consent-service', () => ({
	checkConsent: (...args: unknown[]) => mockCheckConsent(...args),
}));

const mockResolveIdentity = vi.fn();
const mockResolveContext = vi.fn();
const mockAuthorize = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	getAuthProvider: () => ({
		resolveIdentity: mockResolveIdentity,
		resolveContext: mockResolveContext,
		authorize: mockAuthorize,
	}),
	getAuthMode: () => currentAuthMode,
}));

// hooks.server.ts の残り依存モジュールをモック化（並列実行時のモジュール解決高速化）
vi.mock('$app/environment', () => ({ building: false }));

vi.mock('$lib/server/debug-plan', () => ({
	applyDebugPlanOverride: (ctx: unknown) => ctx,
}));

vi.mock('$lib/server/demo/demo-plan', () => ({
	applyDemoPlanToContext: (ctx: unknown) => ctx,
	DEMO_PLAN_COOKIE: 'demo_plan',
	isDemoPlan: () => false,
	resolveDemoPlan: () => 'free',
}));

vi.mock('$lib/server/discord-alert', () => ({
	sendDiscordAlert: vi.fn(async () => {}),
}));

vi.mock('$lib/server/request-context', () => ({
	runWithRequestContext: (fn: () => unknown) => fn(),
	// ADR-0040 P3 (#1215): hooks.server.ts が setEvaluationContext 経由で参照する。
	// ALS 外扱い（undefined 返却）で setEvaluationContext は no-op になる。
	getRequestContext: () => undefined,
}));

vi.mock('$lib/server/routing/legacy-url-map', () => ({
	findLegacyRedirect: () => null,
	rewriteLegacyPath: () => '/',
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyIncident: vi.fn(async () => {}),
}));

// Epic #2525 Phase 7 PR-L0 (#2806): hooks.server.ts は assertLicenseKeyConfigured() を
// import しなくなったため、本 mock は不要 (撤去)。

let currentAuthMode: 'local' | 'cognito' = 'local';

class RedirectError {
	status: number;
	location: string;
	constructor(status: number, location: string) {
		this.status = status;
		this.location = location;
	}
}

vi.mock('@sveltejs/kit', () => ({
	redirect: (status: number, location: string) => {
		throw new RedirectError(status, location);
	},
}));

// --- ヘルパー ---

function createMockEvent(path: string) {
	return {
		url: new URL(`http://localhost${path}`),
		request: { method: 'GET', headers: new Headers() },
		locals: {} as Record<string, unknown>,
		cookies: {
			get: vi.fn(),
			set: vi.fn(),
			delete: vi.fn(),
		},
		getClientAddress: () => '127.0.0.1',
	};
}

function createMockResolve() {
	return vi.fn(async () => new Response('OK', { status: 200 }));
}

beforeEach(() => {
	vi.clearAllMocks();
	currentAuthMode = 'local';
	mockIsSetupRequired.mockResolvedValue(false);
	mockResolveIdentity.mockResolvedValue(null);
	mockResolveContext.mockResolvedValue(null);
	mockAuthorize.mockReturnValue({ allowed: true });
	mockCheckConsent.mockResolvedValue({
		needsReconsent: false,
		termsAccepted: true,
		privacyAccepted: true,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// vi.resetModules() + dynamic import は並列テスト実行時にモジュール解決が遅延するため
// デフォルト 5s では不足することがある
describe('hooks.server.ts handle（結合テスト）', { timeout: 30_000 }, () => {
	// handle 関数は authMode をリクエストごとに getAuthMode() で取得するため、
	// 1回だけ import してキャッシュ可能（currentAuthMode の変更が即座に反映される）
	// biome-ignore lint/suspicious/noExplicitAny: dynamic import の型を静的に参照できないため
	let handle: any;

	beforeAll(async () => {
		const mod = await import('../../../src/hooks.server');
		handle = mod.handle;
	});

	describe('Local モード（認証なし）', () => {
		it('local Identity で /admin アクセス → 正常レスポンス', async () => {
			currentAuthMode = 'local';
			const identity: Identity = { type: 'local' };
			const context: AuthContext = { tenantId: 'local', role: 'owner', licenseStatus: 'none' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(context);
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect(event.locals.authenticated).toBe(true);
			expect(event.locals.identity).toEqual(identity);
			expect(event.locals.context).toEqual(context);
		});

		it('セットアップ未完了 → /setup にリダイレクト', async () => {
			currentAuthMode = 'local';
			mockIsSetupRequired.mockResolvedValue(true);

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/setup');
			}
		});

		it('セットアップ完了済みで /setup アクセス → / にリダイレクト', async () => {
			currentAuthMode = 'local';
			mockIsSetupRequired.mockResolvedValue(false);
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent('/setup');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/');
			}
		});

		it('event.locals に identity/context が正しくセットされる', async () => {
			currentAuthMode = 'local';
			mockResolveIdentity.mockResolvedValue(null);
			mockResolveContext.mockResolvedValue(null);
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent('/');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await handle({ event, resolve } as any);

			expect(event.locals.authenticated).toBe(false);
			expect(event.locals.identity).toBeNull();
			expect(event.locals.context).toBeNull();
		});
	});

	describe('Cognito モード', () => {
		it('セットアップチェックをスキップする', async () => {
			currentAuthMode = 'cognito';
			mockIsSetupRequired.mockResolvedValue(true);
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
		});

		it('Cognito Identity + Context で正常アクセス', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			const context: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'active' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(context);
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect(event.locals.authenticated).toBe(true);
			expect(event.locals.identity).toEqual(identity);
			expect(event.locals.context).toEqual(context);
		});

		it('未認証で /admin → authorize が /auth/login にリダイレクト', async () => {
			currentAuthMode = 'cognito';
			mockAuthorize.mockReturnValue({ allowed: false, redirect: '/auth/login', status: 401 });

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/auth/login');
			}
		});

		it('Context なし（テナント未所属）→ /auth/login にリダイレクト', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(null);
			mockAuthorize.mockReturnValue({ allowed: false, redirect: '/auth/login' });

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/auth/login');
			}
		});

		it('ライセンス期限切れ → /admin/subscription にリダイレクト', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			const context: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'expired' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(context);
			mockAuthorize.mockReturnValue({
				allowed: false,
				redirect: '/admin/subscription?reason=expired',
			});

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/admin/subscription?reason=expired');
			}
		});
	});

	describe('共通動作', () => {
		it('静的ファイル (/_app/*) はリクエストログに記録されない', async () => {
			currentAuthMode = 'local';
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent('/_app/immutable/chunks/app.js');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await handle({ event, resolve } as any);

			const { logger } = await import('$lib/server/logger');
			expect(logger.request).not.toHaveBeenCalled();
		});

		it('/api/health は認証不要でアクセス可能', async () => {
			currentAuthMode = 'local';
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent('/api/health');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
		});
	});

	// #3963: fail-closed の副作用 UX。DB 障害で context を発行できないとき、ログイン画面へ
	// 飛ばすと「ログアウトさせられた / アカウントが消えた」と誤解される (PO 条件 2026-07-26)。
	describe('課金状態を DB から解決できない場合 (#3963 fail-closed)', () => {
		async function importError() {
			const mod = await import('../../../src/lib/server/auth/tenant-entitlement');
			return mod.TenantEntitlementUnavailableError;
		}

		it('HTML リクエストは 503 + 「一時的」と読めるメッセージ (ログイン画面へ送らない)', async () => {
			const TenantEntitlementUnavailableError = await importError();
			currentAuthMode = 'cognito';
			mockResolveIdentity.mockResolvedValue({ type: 'cognito', userId: 'u-1' });
			mockResolveContext.mockRejectedValue(
				new TenantEntitlementUnavailableError('t-1', new Error('DSQL unavailable')),
			);

			const event = createMockEvent('/admin');
			event.request.headers.set('Accept', 'text/html');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);
			const body = await response.text();

			expect(response.status).toBe(503);
			expect(response.headers.get('Retry-After')).toBe('30');
			expect(body).toContain('一時的にご利用いただけません');
			expect(body).toContain('ログアウトはされていません');
			// ログイン画面へのリダイレクトになっていないこと (誤解の元)
			expect(response.headers.get('Location')).toBeNull();
			// ルートハンドラまで到達していないこと (fail-closed)
			expect(resolve).not.toHaveBeenCalled();
		});

		it('API リクエストは 503 JSON + alert kind を含む', async () => {
			const TenantEntitlementUnavailableError = await importError();
			currentAuthMode = 'cognito';
			mockResolveIdentity.mockResolvedValue({ type: 'cognito', userId: 'u-1' });
			mockResolveContext.mockRejectedValue(
				new TenantEntitlementUnavailableError('t-1', new Error('DSQL unavailable')),
			);

			const event = createMockEvent('/api/v1/quests');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);
			const body = (await response.json()) as { error: string; kind: string };

			expect(response.status).toBe(503);
			expect(body.kind).toBe('auth-entitlement-db-unavailable');
			expect(resolve).not.toHaveBeenCalled();
		});

		it('「DB 障害で剥奪」を「正当に無権限」と区別できるログ / alert を出す', async () => {
			const TenantEntitlementUnavailableError = await importError();
			currentAuthMode = 'cognito';
			mockResolveIdentity.mockResolvedValue({ type: 'cognito', userId: 'u-1' });
			mockResolveContext.mockRejectedValue(
				new TenantEntitlementUnavailableError('t-1', new Error('DSQL unavailable')),
			);

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await handle({ event, resolve } as any);

			const { logger } = await import('$lib/server/logger');
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining('auth-entitlement-db-unavailable'),
				expect.objectContaining({
					tenantId: 't-1',
					context: expect.objectContaining({ kind: 'auth-entitlement-db-unavailable' }),
				}),
			);

			const { sendDiscordAlert } = await import('$lib/server/discord-alert');
			expect(sendDiscordAlert).toHaveBeenCalledWith(
				expect.objectContaining({ errorSummary: 'auth-entitlement-db-unavailable', status: 503 }),
			);
		});

		it('課金状態の解決失敗以外の例外はそのまま伝播する (握り潰さない)', async () => {
			currentAuthMode = 'cognito';
			mockResolveIdentity.mockResolvedValue({ type: 'cognito', userId: 'u-1' });
			mockResolveContext.mockRejectedValue(new Error('unexpected'));

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await expect(handle({ event, resolve } as any)).rejects.toThrow('unexpected');
		});

		// #3963 (PO 決裁 2026-07-29 merge 条件): health / readiness probe は課金状態に依存しない。
		// ここが 503 化すると DSQL 障害時に Lambda health / LWA readiness /
		// deploy-aws-staging.yml の post-deploy health / ロールバック判定が誤作動し、
		// 「DB が一時的に不調」だけの状況が「デプロイ失敗」として扱われる。
		it.each([
			'/api/health',
			'/api/ready',
		])('%s は課金状態を DB から解決できなくても 503 にならず通常応答する', async (probePath) => {
			const TenantEntitlementUnavailableError = await importError();
			currentAuthMode = 'cognito';
			// 認証 Cookie を持つクライアントからの probe (identity あり) でも DB 障害で落とさない。
			mockResolveIdentity.mockResolvedValue({ type: 'cognito', userId: 'u-1' });
			mockResolveContext.mockRejectedValue(
				new TenantEntitlementUnavailableError('t-1', new Error('DSQL unavailable')),
			);
			mockAuthorize.mockReturnValue({ allowed: true });

			const event = createMockEvent(probePath);
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			// ルートハンドラまで到達していること (503 で早期 return していない)
			expect(resolve).toHaveBeenCalled();
			// context なしで通す (課金権限は与えない)
			expect(event.locals.context).toBeNull();
		});
	});
	// ── #4497: 同意 gate の適用範囲 ──────────────────────────────────
	//
	// CURRENT_PRIVACY_VERSION の bump によって、この gate は本 PR で初めて実際に発火する
	// (それまでは誰も needsReconsent にならず潜在していた)。誰が再同意画面に流されるのかを
	// 固定しておかないと、子供まで法務文書に突き当たる事故が silent に混入する。
	describe('#4497 同意 gate の適用範囲', () => {
		function setupCognito(role: AuthContext['role']) {
			currentAuthMode = 'cognito';
			mockResolveIdentity.mockResolvedValue({ type: 'cognito', userId: 'u-1' } as Identity);
			mockResolveContext.mockResolvedValue({
				tenantId: 't-1',
				role,
				licenseStatus: 'none',
			} as AuthContext);
			mockAuthorize.mockReturnValue({ allowed: true });
			mockCheckConsent.mockResolvedValue({
				needsReconsent: true,
				termsAccepted: true,
				privacyAccepted: false,
				crossBorderAccepted: false,
			});
		}

		it('保護者 (owner) が再同意対象なら /consent へリダイレクトされる', async () => {
			setupCognito('owner');
			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/consent');
			}
		});

		// 同意主体は保護者 (privacy.html 第9条)。子供に法務文書のチェックボックスを操作させると
		// 同意を得る相手を間違えるうえ、同意後は行き場のない /admin へ飛ばされる。
		it('子供セッションは再同意対象でも子供画面のまま通す (法務文書へ飛ばさない)', async () => {
			setupCognito('child');
			const event = createMockEvent('/preschool/home');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect(resolve).toHaveBeenCalled();
		});

		it('子供セッションでは checkConsent 自体を呼ばない (無駄な read も出さない)', async () => {
			setupCognito('child');
			const event = createMockEvent('/elementary/home');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			await handle({ event, resolve } as any);

			expect(mockCheckConsent).not.toHaveBeenCalled();
		});
	});
});
