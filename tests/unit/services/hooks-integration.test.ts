// tests/unit/services/hooks-integration.test.ts
// hooks.server.ts の結合テスト (#0123: Identity型変更、PIN廃止)

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// フルスイート並列実行時の dynamic import タイムアウト対策
// hooks.server.ts は依存が深く、並列実行時のモジュール解決に時間がかかる
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

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

vi.mock('$lib/analytics', () => ({
	analytics: {
		init: vi.fn(),
		isProviderActive: vi.fn(() => false),
		getUmamiConfig: vi.fn(() => null),
		identify: vi.fn(),
		trackPageView: vi.fn(),
		trackEvent: vi.fn(),
		flush: vi.fn(),
	},
}));

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
}));

vi.mock('$lib/server/routing/legacy-url-map', () => ({
	findLegacyRedirect: () => null,
	rewriteLegacyPath: () => '/',
}));

vi.mock('$lib/server/services/analytics-service', () => ({
	trackServerError: vi.fn(),
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyIncident: vi.fn(async () => {}),
}));

vi.mock('$lib/server/services/license-key-service', () => ({
	assertLicenseKeyConfigured: vi.fn(),
}));

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

		it('ライセンス期限切れ → /admin/license にリダイレクト', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			const context: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'expired' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(context);
			mockAuthorize.mockReturnValue({
				allowed: false,
				redirect: '/admin/license?reason=expired',
			});

			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/admin/license?reason=expired');
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
});
