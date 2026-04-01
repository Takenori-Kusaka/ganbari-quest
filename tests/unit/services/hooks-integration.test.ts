// tests/unit/services/hooks-integration.test.ts
// hooks.server.ts の結合テスト (#0123: Identity型変更、PIN廃止)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// --- モック定義 ---

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
	checkAuthRateLimit: () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 }),
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

describe('hooks.server.ts handle（結合テスト）', () => {
	async function loadHandle() {
		vi.resetModules();
		// vi.mock はトップレベルで定義済み — ここでは再宣言不要
		// vi.resetModules() 後でもトップレベルのモック定義が有効
		const mod = await import('../../../src/hooks.server');
		return mod.handle;
	}

	describe('Local モード（認証なし）', () => {
		it('local Identity で /admin アクセス → 正常レスポンス', async () => {
			currentAuthMode = 'local';
			const identity: Identity = { type: 'local' };
			const context: AuthContext = { tenantId: 'local', role: 'owner', licenseStatus: 'none' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(context);
			mockAuthorize.mockReturnValue({ allowed: true });

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
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

			const handle = await loadHandle();
			const event = createMockEvent('/api/health');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
		});
	});
});
