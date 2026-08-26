// tests/unit/routes/auth-invite-no-fallback.test.ts
// #4636: 招待受諾に失敗したとき、新規家族グループ (テナント) へ自動フォールバックしないことの回帰固定。
//
// 旧実装は `resolveMembership` が受諾失敗のたびに `provisionNewUser` を呼び、招待された人が
// 「別世帯の owner」として空の管理画面に着地していた (#4633 で 2 件の実害を PO が報告)。
// #4635 は理由バナーを足しただけで着地先は変えていないため、構造は残っていた。
//
// 招待 (invites) / メンバー (memberships) は local backend では起動できない (#3732) ため、
// CognitoAuthProvider を直接結線して「受諾失敗 → context 未発行 + テナント未作成」を固定する。
// staging 実機検証手順は PR body 参照。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	INVITE_ACCEPT_ERROR_REASONS,
	INVITE_COOKIE_NAME,
} from '../../../src/lib/domain/validation/auth';

const mockFindUserTenants = vi.fn();
const mockFindUserByEmail = vi.fn();
const mockFindTenantById = vi.fn();
const mockCreateUser = vi.fn();
const mockCreateTenant = vi.fn();
const mockCreateMembership = vi.fn();
const mockFindChildByUserId = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findUserTenants: mockFindUserTenants,
			findUserByEmail: mockFindUserByEmail,
			findTenantById: mockFindTenantById,
			createUser: mockCreateUser,
			createTenant: mockCreateTenant,
			createMembership: mockCreateMembership,
		},
		child: { findChildByUserId: mockFindChildByUserId },
	}),
}));

const mockGetInvite = vi.fn();
const mockAcceptInvite = vi.fn();
vi.mock('$lib/server/services/invite-service', () => ({
	getInvite: (...args: unknown[]) => mockGetInvite(...args),
	acceptInvite: (...args: unknown[]) => mockAcceptInvite(...args),
}));

vi.mock('$lib/server/auth/context-token', () => ({
	signContext: vi.fn(() => 'signed-context-token'),
	verifyContext: vi.fn(() => null),
	getContextMaxAge: vi.fn(() => 86400),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/server/auth/providers/cognito-oauth', () => ({
	refreshCognitoIdToken: vi.fn(async () => null),
}));

vi.mock('$lib/server/auth/providers/cognito-jwt', () => ({
	verifyIdentityToken: vi.fn(async () => null),
	hasMfaAmr: vi.fn(() => false),
}));

import { CognitoAuthProvider } from '../../../src/lib/server/auth/providers/cognito';

const INVITE_CODE = 'inv-no-fallback-4636';
const INVITING_TENANT_ID = 't-inviting-family';

function createEvent(cookieJar: Map<string, string>) {
	const cookies = {
		get: (name: string) => cookieJar.get(name),
		set: (name: string, value: string) => {
			cookieJar.set(name, value);
		},
		delete: (name: string) => {
			cookieJar.delete(name);
		},
		getAll: () => [...cookieJar.entries()].map(([name, value]) => ({ name, value })),
		serialize: () => '',
	};
	// biome-ignore lint/suspicious/noExplicitAny: RequestEvent の部分モック
	return { cookies, url: new URL('http://localhost/admin') } as any;
}

const invitedIdentity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-invited',
	email: 'invited@example.com',
	emailVerified: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockFindUserByEmail.mockResolvedValue(null);
	mockFindUserTenants.mockResolvedValue([]);
	mockCreateUser.mockResolvedValue({ userId: 'u-invited', email: invitedIdentity.email });
	mockFindChildByUserId.mockResolvedValue(null);
	mockFindTenantById.mockResolvedValue({ tenantId: INVITING_TENANT_ID, status: 'active' });
	mockGetInvite.mockResolvedValue({
		inviteId: 'i-1',
		tenantId: INVITING_TENANT_ID,
		role: 'parent',
		expiresAt: new Date(Date.now() + 86400_000).toISOString(),
		status: 'pending',
	});
});

describe('#4636 招待受諾失敗時に新規家族グループを自動作成しない', () => {
	it.each([
		...INVITE_ACCEPT_ERROR_REASONS,
	])('受諾拒否 (%s) でテナントを作らず context も発行しない', async (reason) => {
		const jar = new Map<string, string>([[INVITE_COOKIE_NAME, INVITE_CODE]]);
		mockAcceptInvite.mockResolvedValue({ error: reason });

		const context = await new CognitoAuthProvider().resolveContext(
			createEvent(jar),
			invitedIdentity,
		);

		expect(context).toBeNull();
		expect(mockCreateTenant).not.toHaveBeenCalled();
		expect(mockCreateMembership).not.toHaveBeenCalled();
	});

	it('受諾が例外で落ちてもテナントを作らない', async () => {
		const jar = new Map<string, string>([[INVITE_COOKIE_NAME, INVITE_CODE]]);
		mockAcceptInvite.mockRejectedValue(new Error('db down'));

		const context = await new CognitoAuthProvider().resolveContext(
			createEvent(jar),
			invitedIdentity,
		);

		expect(context).toBeNull();
		expect(mockCreateTenant).not.toHaveBeenCalled();
	});

	it('受諾失敗後も招待 Cookie を残す (理由の再導出と、原因解消後の自動合流のため)', async () => {
		const jar = new Map<string, string>([[INVITE_COOKIE_NAME, INVITE_CODE]]);
		mockAcceptInvite.mockResolvedValue({ error: 'INVITE_EMAIL_UNVERIFIED' });

		await new CognitoAuthProvider().resolveContext(createEvent(jar), invitedIdentity);

		expect(jar.get(INVITE_COOKIE_NAME)).toBe(INVITE_CODE);
	});

	it('原因が解消されれば次のリクエストで招待元テナントに合流する (dead-end にしない)', async () => {
		const jar = new Map<string, string>([[INVITE_COOKIE_NAME, INVITE_CODE]]);
		mockAcceptInvite.mockResolvedValueOnce({ error: 'INVITE_EMAIL_UNVERIFIED' });
		const provider = new CognitoAuthProvider();

		expect(await provider.resolveContext(createEvent(jar), invitedIdentity)).toBeNull();

		mockAcceptInvite.mockResolvedValue({
			membership: { userId: 'u-invited', tenantId: INVITING_TENANT_ID, role: 'parent' },
		});
		const context = await provider.resolveContext(createEvent(jar), invitedIdentity);

		expect(context?.tenantId).toBe(INVITING_TENANT_ID);
		expect(mockCreateTenant).not.toHaveBeenCalled();
		// 成功時は残留防止で Cookie を消費する (#0203)
		expect(jar.has(INVITE_COOKIE_NAME)).toBe(false);
	});

	it('招待 Cookie が無い通常のサインアップは従来どおり自動プロビジョニングする', async () => {
		const jar = new Map<string, string>();
		mockCreateTenant.mockResolvedValue({ tenantId: 't-new-family' });
		mockCreateMembership.mockResolvedValue({
			userId: 'u-invited',
			tenantId: 't-new-family',
			role: 'owner',
		});
		mockFindTenantById.mockResolvedValue({ tenantId: 't-new-family', status: 'active' });

		const context = await new CognitoAuthProvider().resolveContext(
			createEvent(jar),
			invitedIdentity,
		);

		expect(context?.tenantId).toBe('t-new-family');
		expect(context?.role).toBe('owner');
		expect(mockCreateTenant).toHaveBeenCalledTimes(1);
	});
});
