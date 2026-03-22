// tests/unit/services/hooks-integration.test.ts
// hooks.server.ts の結合テスト
// handle フック全体を通して、Identity→Context→authorize→redirect の一連のフローをテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// --- モック定義 ---

// isSetupRequired モック
const mockIsSetupRequired = vi.fn();
vi.mock('$lib/server/services/setup-service', () => ({
	isSetupRequired: () => mockIsSetupRequired(),
}));

// logger モック
vi.mock('$lib/server/logger', () => ({
	logger: {
		request: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

// AuthProvider モック
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

// SvelteKit redirect モック — 実際と同じく例外を throw する
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
		request: { method: 'GET' },
		locals: {} as Record<string, unknown>,
		cookies: {
			get: vi.fn(),
			set: vi.fn(),
			delete: vi.fn(),
		},
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
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('hooks.server.ts handle（結合テスト）', () => {
	async function loadHandle() {
		// モジュールキャッシュをリセットして再読み込み
		vi.resetModules();
		// モックを再定義（resetModules で消える）
		vi.mock('$lib/server/services/setup-service', () => ({
			isSetupRequired: () => mockIsSetupRequired(),
		}));
		vi.mock('$lib/server/logger', () => ({
			logger: { request: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
		}));
		vi.mock('$lib/server/auth/factory', () => ({
			getAuthProvider: () => ({
				resolveIdentity: mockResolveIdentity,
				resolveContext: mockResolveContext,
				authorize: mockAuthorize,
			}),
			getAuthMode: () => currentAuthMode,
		}));
		vi.mock('@sveltejs/kit', () => ({
			redirect: (status: number, location: string) => {
				throw new RedirectError(status, location);
			},
		}));

		const mod = await import('../../../src/hooks.server');
		return mod.handle;
	}

	describe('Local モード', () => {
		it('未認証で /admin アクセス → provider.authorize が /login リダイレクト', async () => {
			currentAuthMode = 'local';
			mockAuthorize.mockReturnValue({ allowed: false, redirect: '/login' });
			const handle = await loadHandle();
			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/login');
			}
		});

		it('認証済みで /admin アクセス → 正常レスポンス', async () => {
			currentAuthMode = 'local';
			const identity: Identity = { type: 'pin', sessionId: 'session-123' };
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
			// authorize は /setup に対して allowed: true を返す想定だが、
			// setup完了チェックが先にリダイレクトする
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
			mockIsSetupRequired.mockResolvedValue(true); // 仮に true でも
			mockAuthorize.mockReturnValue({ allowed: true });

			const handle = await loadHandle();
			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			// セットアップリダイレクトされず正常レスポンス
			expect(response.status).toBe(200);
			// isSetupRequired が呼ばれないことは保証しない（呼ばれてもスキップされる）
		});

		it('OAuth Identity + Context で正常アクセス', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'oauth', userId: 'u-1', email: 'a@b.com' };
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

		it('未認証で /admin → authorize が /login にリダイレクト', async () => {
			currentAuthMode = 'cognito';
			mockAuthorize.mockReturnValue({ allowed: false, redirect: '/login', status: 401 });

			const handle = await loadHandle();
			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/login');
			}
		});

		it('Device Token で /child アクセス可能', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'device', deviceId: 'd-1', tenantId: 't-1' };
			const context: AuthContext = { tenantId: 't-1', role: 'child', licenseStatus: 'active' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(context);
			mockAuthorize.mockReturnValue({ allowed: true });

			const handle = await loadHandle();
			const event = createMockEvent('/child');
			const resolve = createMockResolve();

			// biome-ignore lint/suspicious/noExplicitAny: test mock
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect((event.locals.identity as Identity | null)?.type).toBe('device');
		});

		it('Context なし（テナント未選択）→ /auth/select-tenant にリダイレクト', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'oauth', userId: 'u-1', email: 'a@b.com' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(null);
			mockAuthorize.mockReturnValue({ allowed: false, redirect: '/auth/select-tenant' });

			const handle = await loadHandle();
			const event = createMockEvent('/admin');
			const resolve = createMockResolve();

			try {
				// biome-ignore lint/suspicious/noExplicitAny: test mock
				await handle({ event, resolve } as any);
				expect.fail('redirect should have been thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(RedirectError);
				expect((e as RedirectError).location).toBe('/auth/select-tenant');
			}
		});

		it('ライセンス期限切れ → /admin/billing にリダイレクト', async () => {
			currentAuthMode = 'cognito';
			const identity: Identity = { type: 'oauth', userId: 'u-1', email: 'a@b.com' };
			const context: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'expired' };
			mockResolveIdentity.mockResolvedValue(identity);
			mockResolveContext.mockResolvedValue(context);
			mockAuthorize.mockReturnValue({
				allowed: false,
				redirect: '/admin/billing?reason=expired',
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
				expect((e as RedirectError).location).toBe('/admin/billing?reason=expired');
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

			// logger.request は呼ばれない（静的ファイル除外）
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
