// tests/unit/services/cognito-provider.test.ts
// CognitoAuthProvider のユニットテスト (#0123: DeviceToken廃止, oauth→cognito)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// --- モック定義 ---

const mockFindUserTenants = vi.fn();
const mockFindTenantById = vi.fn();
const mockFindUserByEmail = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findUserTenants: mockFindUserTenants,
			findTenantById: mockFindTenantById,
			findUserByEmail: mockFindUserByEmail,
		},
	}),
}));

const mockVerifyIdentityToken = vi.fn();
vi.mock('$lib/server/auth/providers/cognito-jwt', () => ({
	verifyIdentityToken: (...args: unknown[]) => mockVerifyIdentityToken(...args),
	// #4266: MFA 判定は純関数のため mock せず実体と同じ挙動を返す
	hasMfaAmr: (amr: readonly string[] | undefined) =>
		Array.isArray(amr) && amr.some((m) => m.toLowerCase().includes('mfa')),
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
				groups: undefined,
				// #3025: identities claim なし = password ユーザ (federated でない)
				isFederated: false,
				authTime: undefined,
				// #4266: amr claim なし = MFA を経ていない (fail-closed で /ops に入れない)
				mfaAuthenticated: false,
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

		// #3963: Cookie から取るのは claim (tenantId / role / childId) のみ。
		// 課金状態 (licenseStatus / tenantStatus / plan) は毎リクエスト DB から解決する。
		// 以前は Cookie の値をそのまま返していたため、Stripe webhook / 解約が DB を
		// 更新しても最大 24h 古い値が使われ続けた。
		it('有効な Context Token Cookie の claim を使い、課金状態は DB から解決する', async () => {
			mockVerifyContext.mockReturnValue({
				tenantId: 't-cached',
				role: 'owner',
			});
			// DB 側は subscription 無し (= 無料) の状態
			mockFindTenantById.mockResolvedValue({ tenantId: 't-cached', status: 'active' });

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			const event = createMockEvent({ context_token: 'valid-context-token' });

			const context = await provider.resolveContext(event, identity);

			expect(context).toEqual({
				tenantId: 't-cached',
				role: 'owner',
				licenseStatus: 'none',
				tenantStatus: 'active',
				plan: undefined,
				// #4585-2: 契約の有無 (S4 停止 / S5 契約終了 の判別軸) も DB から解決する
				stripeSubscriptionId: null,
			});
			// Cookie が有効なのでメンバーシップ再解決は走らないが、課金状態のため DB は引く
			expect(mockFindUserTenants).not.toHaveBeenCalled();
			expect(mockFindTenantById).toHaveBeenCalledWith('t-cached');
		});

		// Cookie に古い課金状態が焼き込まれていても DB の現在値が勝つこと
		it('Cookie が無料 (none) を焼き込んでいても DB が有料なら DB の plan を返す', async () => {
			mockVerifyContext.mockReturnValue({
				tenantId: 't-cached',
				role: 'owner',
				licenseStatus: 'none',
				plan: undefined,
			} as AuthContext);
			mockFindTenantById.mockResolvedValue({
				tenantId: 't-cached',
				status: 'active',
				stripeSubscriptionId: 'sub_1',
				plan: 'monthly',
			});

			const { CognitoAuthProvider } = await import(
				'../../../src/lib/server/auth/providers/cognito'
			);
			const provider = new CognitoAuthProvider();
			const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'a@b.com' };
			const event = createMockEvent({ context_token: 'valid-context-token' });

			const context = await provider.resolveContext(event, identity);

			expect(context?.licenseStatus).toBe('active');
			expect(context?.plan).toBe('monthly');
		});

		it('Context Token がない場合、メンバーシップから Context を発行する', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserByEmail.mockResolvedValue({ userId: 'u-member', email: 'owner@family.com' });
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
				licenseStatus: 'none',
				tenantStatus: 'active',
				plan: undefined,
				// #4585-2: 契約の有無 (S4 停止 / S5 契約終了 の判別軸) も DB から解決する
				stripeSubscriptionId: null,
			});
			expect(mockFindUserByEmail).toHaveBeenCalledWith('owner@family.com');
			expect(mockFindUserTenants).toHaveBeenCalledWith('u-member');
			expect(event.cookies.set).toHaveBeenCalled();
		});

		it('Cognito ユーザーがテナント未所属の場合 null を返す', async () => {
			mockVerifyContext.mockReturnValue(null);
			mockFindUserByEmail.mockResolvedValue(undefined);
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
			mockFindUserByEmail.mockResolvedValue({ userId: 'u-single', email: 'single@example.com' });
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
			mockFindUserByEmail.mockResolvedValue({ userId: 'u-err', email: 'err@x.com' });
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
			mockFindUserByEmail.mockResolvedValue({ userId: 'u-expired', email: 'expired@x.com' });
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
