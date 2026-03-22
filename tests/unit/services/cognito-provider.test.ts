// tests/unit/services/cognito-provider.test.ts
// CognitoAuthProvider のユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// --- モック定義 ---

const mockFindDeviceToken = vi.fn();
const mockFindUserTenants = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findDeviceToken: mockFindDeviceToken,
			findUserTenants: mockFindUserTenants,
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
	verifyContext: vi.fn(() => null), // デフォルトで期限切れ（null）
	getContextMaxAge: vi.fn(() => 86400),
}));

vi.mock('$lib/domain/validation/auth', () => ({
	IDENTITY_COOKIE_NAME: 'identity_token',
	CONTEXT_COOKIE_NAME: 'context_token',
	DEVICE_COOKIE_NAME: 'device_token',
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
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('CognitoAuthProvider', () => {
	describe('resolveIdentity', () => {
		it('Identity Token (OAuth JWT) から Identity を解決する', async () => {
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
				type: 'oauth',
				userId: 'u-abc-123',
				email: 'parent@example.com',
			});
			expect(mockVerifyIdentityToken).toHaveBeenCalledWith('valid-jwt');
		});

		it('Identity Token がない場合、Device Token にフォールバックする', async () => {
			mockFindDeviceToken.mockResolvedValue({
				deviceId: 'd-tablet-1',
				tenantId: 't-family-1',
				status: 'active',
			});

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({ device_token: 'd-tablet-1' });

			const identity = await provider.resolveIdentity(event);

			expect(identity).toEqual({
				type: 'device',
				deviceId: 'd-tablet-1',
				tenantId: 't-family-1',
			});
		});

		it('Identity Token の検証失敗時、Device Token にフォールバックする', async () => {
			mockVerifyIdentityToken.mockResolvedValue(null);
			mockFindDeviceToken.mockResolvedValue({
				deviceId: 'd-tablet-2',
				tenantId: 't-family-2',
				status: 'active',
			});

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({
				identity_token: 'invalid-jwt',
				device_token: 'd-tablet-2',
			});

			const identity = await provider.resolveIdentity(event);

			expect(identity).toEqual({
				type: 'device',
				deviceId: 'd-tablet-2',
				tenantId: 't-family-2',
			});
		});

		it('Device Token が revoked の場合 null を返す', async () => {
			mockFindDeviceToken.mockResolvedValue({
				deviceId: 'd-revoked',
				tenantId: 't-family-1',
				status: 'revoked',
			});

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({ device_token: 'd-revoked' });

			const identity = await provider.resolveIdentity(event);

			expect(identity).toBeNull();
		});

		it('Device Token が存在しない場合 null を返す', async () => {
			mockFindDeviceToken.mockResolvedValue(undefined);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({ device_token: 'd-unknown' });

			const identity = await provider.resolveIdentity(event);

			expect(identity).toBeNull();
		});

		it('Cookie が何もない場合 null を返す', async () => {
			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({});

			const identity = await provider.resolveIdentity(event);

			expect(identity).toBeNull();
		});

		it('Identity Token 検証で例外が発生しても Device Token にフォールバックする', async () => {
			mockVerifyIdentityToken.mockRejectedValue(new Error('network error'));
			mockFindDeviceToken.mockResolvedValue({
				deviceId: 'd-fallback',
				tenantId: 't-family-3',
				status: 'active',
			});

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({
				identity_token: 'jwt-with-error',
				device_token: 'd-fallback',
			});

			const identity = await provider.resolveIdentity(event);

			expect(identity).toEqual({
				type: 'device',
				deviceId: 'd-fallback',
				tenantId: 't-family-3',
			});
		});

		it('Device Token 検索で例外が発生した場合 null を返す', async () => {
			mockFindDeviceToken.mockRejectedValue(new Error('DynamoDB error'));

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({ device_token: 'd-error' });

			const identity = await provider.resolveIdentity(event);

			expect(identity).toBeNull();
		});

		it('Identity Token が優先される（両方ある場合）', async () => {
			mockVerifyIdentityToken.mockResolvedValue({
				sub: 'u-priority',
				email: 'priority@example.com',
			});
			mockFindDeviceToken.mockResolvedValue({
				deviceId: 'd-should-not-use',
				tenantId: 't-family-99',
				status: 'active',
			});

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const event = createMockEvent({
				identity_token: 'valid-jwt',
				device_token: 'd-should-not-use',
			});

			const identity = await provider.resolveIdentity(event);

			expect(identity?.type).toBe('oauth');
			expect(mockFindDeviceToken).not.toHaveBeenCalled();
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
			const identity: Identity = { type: 'oauth', userId: 'u-1', email: 'a@b.com' };
			const event = createMockEvent({ context_token: 'valid-context-token' });

			const context = await provider.resolveContext(event, identity);

			expect(context).toEqual(storedContext);
			// メンバーシップ検索はしない
			expect(mockFindUserTenants).not.toHaveBeenCalled();
		});

		it('Context Token がない場合、メンバーシップから Context を発行する（OAuth）', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockResolvedValue([
				{ userId: 'u-member', tenantId: 't-family-A', role: 'owner', joinedAt: '2024-01-01' },
			]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'oauth', userId: 'u-member', email: 'owner@family.com' };
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context).toEqual({
				tenantId: 't-family-A',
				role: 'owner',
				licenseStatus: 'active',
			});
			expect(mockFindUserTenants).toHaveBeenCalledWith('u-member');
			// Context Cookie が設定される
			expect(event.cookies.set).toHaveBeenCalled();
		});

		it('OAuth ユーザーがテナント未所属の場合 null を返す', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockResolvedValue([]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'oauth', userId: 'u-orphan', email: 'no-tenant@x.com' };
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context).toBeNull();
		});

		it('Device Token の場合、テナント固定で child ロールを返す', async () => {
			mockVerifyContext.mockReturnValue(null);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'device', deviceId: 'd-1', tenantId: 't-device-tenant' };
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context).toEqual({
				tenantId: 't-device-tenant',
				role: 'child',
				licenseStatus: 'active',
			});
			// Device の場合メンバーシップ検索しない
			expect(mockFindUserTenants).not.toHaveBeenCalled();
		});

		it('複数テナントの場合、最初のテナントを自動選択する', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockResolvedValue([
				{ userId: 'u-multi', tenantId: 't-first', role: 'parent', joinedAt: '2024-01-01' },
				{ userId: 'u-multi', tenantId: 't-second', role: 'viewer', joinedAt: '2024-06-01' },
			]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'oauth', userId: 'u-multi', email: 'multi@example.com' };
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context?.tenantId).toBe('t-first');
			expect(context?.role).toBe('parent');
		});

		it('メンバーシップ検索で例外が発生した場合 null を返す', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserTenants.mockRejectedValue(new Error('DynamoDB timeout'));

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'oauth', userId: 'u-err', email: 'err@x.com' };
			const event = createMockEvent({});

			const context = await provider.resolveContext(event, identity);

			expect(context).toBeNull();
		});

		it('Context Token が期限切れの場合、メンバーシップから再発行する', async () => {
			mockVerifyContext.mockReturnValue(null); // 期限切れ
			mockFindUserTenants.mockResolvedValue([
				{ userId: 'u-expired', tenantId: 't-reissue', role: 'owner', joinedAt: '2024-01-01' },
			]);

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = {
				type: 'oauth',
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
			const identity: Identity = { type: 'oauth', userId: 'u-1', email: 'a@b.com' };
			const context: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'active' };

			const result = provider.authorize('/admin', identity, context);

			expect(result).toEqual({ allowed: true });
		});

		it('未認証で /admin は /login にリダイレクト', async () => {
			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();

			const result = provider.authorize('/admin', null, null);

			expect(result.allowed).toBe(false);
			if (!result.allowed) {
				expect(result.redirect).toBe('/login');
			}
		});
	});
});
