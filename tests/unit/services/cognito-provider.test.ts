// tests/unit/services/cognito-provider.test.ts
// CognitoAuthProvider のユニットテスト (#0123: DeviceToken廃止, oauth→cognito)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// --- モック定義 ---

const mockFindUserTenants = vi.fn();
const mockFindTenantById = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findUserTenants: mockFindUserTenants,
			findTenantById: mockFindTenantById,
		},
	}),
}));

const mockVerifyIdentityToken = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-jwt', () => ({
	verifyIdentityToken: (...args: unknown[]) => mockVerifyIdentityToken(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

// Context token モック
vi.mock('$lib/server/auth/context-token', () => ({
	signContext: vi.fn(() => 'mock-signed-context-token'),
	verifyContext: vi.fn(() => null),
	getContextMaxAge: vi.fn(() => 86400),
}));

vi.mock('$lib/domain/validation/auth', () => ({
	IDENTITY_COOKIE_NAME: 'identity_token',
	CONTEXT_COOKIE_NAME: 'context_token',
}));

import { verifyContext } from '$lib/server/auth/context-token';

const mockVerifyContext = vi.mocked(verifyContext);

// --- Cookie モック ---

function createMockEvent(cookies: Record<string, string> = {}) {
	const cookieStore = new Map(Object.entries(cookies));
	return {
		cookies: {
			get: (name: string) => cookieStore.get(name),
			set: vi.fn((name: string, value: string) => cookieStore.set(name, value)),
			delete: vi.fn((name: string) => cookieStore.delete(name)),
		},
		url: new URL('http://localhost/admin'),
		// biome-ignore lint/suspicious/noExplicitAny: RequestEvent mock
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTenantById.mockResolvedValue({ tenantId: 'default', status: 'active' });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('CognitoAuthProvider', () => {
	describe('resolveIdentity', () => {
		it('Identity Token (JWT) から Identity を解決する', async () => {
			mockVerifyIdentityToken.mockResolvedValue({
				sub: 'u-abc-123',
				email: 'parent@example.com',
			});

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({ identity_token: 'valid-jwt' });

			const identity = await provider.resolveIdentity(event);

			expect(identity).toEqual({
				type: 'cognito',
				userId: 'u-abc-123',
				email: 'parent@example.com',
			});
			expect(mockVerifyIdentityToken).toHaveBeenCalledWith('valid-jwt');
		});

		it('Identity Token がない場合 null を返す', async () => {
			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({});

			const identity = await provider.resolveIdentity(event);

			expect(identity).toBeNull();
		});

		it('Identity Token の検証失敗時 null を返す', async () => {
			mockVerifyIdentityToken.mockResolvedValue(null);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({ identity_token: 'invalid-jwt' });

			const identity = await provider.resolveIdentity(event);

			expect(identity).toBeNull();
		});

		it('Identity Token 検証で例外が発生しても null を返す', async () => {
			mockVerifyIdentityToken.mockRejectedValue(new Error('network error'));

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({ identity_token: 'jwt-with-error' });

			const identity = await provider.resolveIdentity(event);

			expect(identity).toBeNull();
		});
	});

	describe('resolveContext', () => {
		it('Identity が null の場合 null を返す', async () => {
			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, null);

			expect(context).toBeNull();
		});

		it('有効な Context Token Cookie から Context を返す', async () => {
			const storedContext: AuthContext = {
				tenantId: 't-cached',
				role: 'owner',
				licenseStatus: 'active',
			};
			mockVerifyContext.mockReturnValue(storedContext);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			const event = createMockEvent({ context_token: 'valid-context-token' });

			const context = await provider.resolveContext(event, identity);

			expect(context).toEqual(storedContext);
			expect(mockFindUserTenants).not.toHaveBeenCalled();
		});

		it('Context Token がない場合、メンバーシップから Context を発行する', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockResolvedValue([
				{ userId: 'u-member', tenantId: 't-family-A', role: 'owner', joinedAt: '2024-01-01' },
			]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = {
				type: 'cognito',
				userId: 'u-member',
				email: 'owner@family.com',
			};
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context).toEqual({
				tenantId: 't-family-A',
				role: 'owner',
				licenseStatus: 'active',
				tenantStatus: 'active',
			});
			expect(mockFindUserTenants).toHaveBeenCalledWith('u-member');
			expect(event.cookies.set).toHaveBeenCalled();
		});

		it('Cognito ユーザーがテナント未所属の場合 null を返す', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockResolvedValue([]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = {
				type: 'cognito',
				userId: 'u-orphan',
				email: 'no-tenant@x.com',
			};
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context).toBeNull();
		});

		it('1ユーザー=1テナント: 最初のテナントを自動選択する', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockResolvedValue([
				{ userId: 'u-single', tenantId: 't-only', role: 'parent', joinedAt: '2024-01-01' },
			]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = {
				type: 'cognito',
				userId: 'u-single',
				email: 'single@example.com',
			};
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context?.tenantId).toBe('t-only');
			expect(context?.role).toBe('parent');
		});

		it('メンバーシップ検索で例外が発生した場合 null を返す', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockRejectedValue(new Error('DynamoDB timeout'));

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'cognito', userId: 'u-err', email: 'err@x.com' };
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context).toBeNull();
		});

		it('Context Token が期限切れの場合、メンバーシップから再発行する', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockResolvedValue([
				{ userId: 'u-expired', tenantId: 't-reissue', role: 'owner', joinedAt: '2024-01-01' },
			]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = {
				type: 'cognito',
				userId: 'u-expired',
				email: 'expired@x.com',
			};
			const event = createMockEvent({ context_token: 'expired-token' });

			const context = await provider.resolveContext(event, identity);

			expect(context?.tenantId).toBe('t-reissue');
			expect(mockFindUserTenants).toHaveBeenCalled();
		});
	});

	describe('authorize', () => {
		it('authorizeCognito に委譲する', async () => {
			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			const context: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'active' };

			const result = provider.authorize('/admin', identity, context);

			expect(result).toEqual({ allowed: true });
		});

		it('未認証で /admin は /auth/login にリダイレクト', async () => {
			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();

			const result = provider.authorize('/admin', null, null);

			expect(result.allowed).toBe(false);
			if (!result.allowed) {
				expect(result.redirect).toBe('/auth/login');
			}
		});
	});
});
