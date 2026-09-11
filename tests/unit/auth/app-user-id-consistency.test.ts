// tests/unit/auth/app-user-id-consistency.test.ts
// #4643: IdP の sub (`Identity.userId`) と アプリ DB の `users.user_id` は別物である。
//
// Cognito は同じメールアドレスでも「通常ログインのユーザー」と「Google 連携のユーザー」を
// 別 sub の別ユーザーとして扱う。一方アプリ側の `users` は `email_lower` UNIQUE で
// 1 メール = 1 行に統合し、`user_id` は DB 生成 UUID である。したがって sub を
// `users.user_id` として使うコードは、どのユーザーでも必ず取り違える。
//
// 本 test は「セッションが持つアプリ側 user id (`AuthContext.userId`) が、どの IdP 経路から
// ログインしても同一の users 行を指す」ことを固定する。招待 / メンバーは local backend では
// 起動できない (#3732) ため provider を直接結線する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindUserByEmail = vi.fn();
const mockFindUserTenants = vi.fn();
const mockFindTenantById = vi.fn();
const mockCreateUser = vi.fn();
const mockCreateTenant = vi.fn();
const mockCreateMembership = vi.fn();
const mockFindChildByUserId = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findUserByEmail: mockFindUserByEmail,
			findUserTenants: mockFindUserTenants,
			findTenantById: mockFindTenantById,
			createUser: mockCreateUser,
			createTenant: mockCreateTenant,
			createMembership: mockCreateMembership,
		},
		child: { findChildByUserId: mockFindChildByUserId },
	}),
}));

vi.mock('$lib/server/services/invite-service', () => ({
	acceptInvite: vi.fn(),
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

import {
	getContextMaxAge,
	signContext,
	verifyContext,
} from '../../../src/lib/server/auth/context-token';
import { CognitoAuthProvider } from '../../../src/lib/server/auth/providers/cognito';

const EMAIL = 'shared@example.com';
const APP_USER_ID = 'u-11111111-1111-4111-8111-111111111111';
const TENANT_ID = 't-family';

/** 同じ人の 2 通りのログイン。Cognito では sub が別になる。 */
const nativeIdentity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-native',
	email: EMAIL,
	emailVerified: true,
};
const googleIdentity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-google',
	email: EMAIL,
	emailVerified: true,
	isFederated: true,
};

function createEvent() {
	const jar = new Map<string, string>();
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => {
			jar.set(name, value);
		},
		delete: (name: string) => {
			jar.delete(name);
		},
	};
	// biome-ignore lint/suspicious/noExplicitAny: RequestEvent の部分モック
	return { jar, event: { cookies, url: new URL('http://localhost/admin') } as any };
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.CONTEXT_TOKEN_SECRET ??= 'test-secret-for-context-token';
	mockFindUserByEmail.mockResolvedValue({ userId: APP_USER_ID, email: EMAIL });
	mockFindUserTenants.mockResolvedValue([
		{ userId: APP_USER_ID, tenantId: TENANT_ID, role: 'parent', joinedAt: '2026-01-01' },
	]);
	mockFindTenantById.mockResolvedValue({ tenantId: TENANT_ID, status: 'active' });
	mockFindChildByUserId.mockResolvedValue(null);
});

describe('#4643 IdP sub と アプリ user id の分離', () => {
	it('context には sub ではなくアプリ側 users.user_id が載る', async () => {
		const { event } = createEvent();

		const context = await new CognitoAuthProvider().resolveContext(event, nativeIdentity);

		expect(context?.userId).toBe(APP_USER_ID);
		expect(context?.userId).not.toBe(nativeIdentity.userId);
	});

	it('同じメールなら通常ログインと Google 連携で同じアプリ user / 同じ家族グループになる', async () => {
		const provider = new CognitoAuthProvider();

		const native = await provider.resolveContext(createEvent().event, nativeIdentity);
		const google = await provider.resolveContext(createEvent().event, googleIdentity);

		expect(google?.userId).toBe(native?.userId);
		expect(google?.tenantId).toBe(native?.tenantId);
		// sub をキーに users を引き直して新しい世帯を作ってしまわないこと
		expect(mockCreateTenant).not.toHaveBeenCalled();
		expect(mockCreateUser).not.toHaveBeenCalled();
	});

	it('users 行が無ければ membership 検索を sub で撃たない (存在しない id での空振り防止)', async () => {
		mockFindUserByEmail.mockResolvedValue(undefined);
		mockFindUserTenants.mockResolvedValue([]);
		mockCreateUser.mockResolvedValue({ userId: 'u-new', email: EMAIL });
		mockCreateTenant.mockResolvedValue({ tenantId: 't-new' });
		mockCreateMembership.mockResolvedValue({
			userId: 'u-new',
			tenantId: 't-new',
			role: 'owner',
		});
		mockFindTenantById.mockResolvedValue({ tenantId: 't-new', status: 'active' });

		const context = await new CognitoAuthProvider().resolveContext(
			createEvent().event,
			googleIdentity,
		);

		expect(context?.userId).toBe('u-new');
		expect(mockFindUserTenants).not.toHaveBeenCalledWith(googleIdentity.userId);
	});

	it('child ロールの子供プロフィール解決に sub を使わない', async () => {
		mockFindUserTenants.mockResolvedValue([
			{ userId: APP_USER_ID, tenantId: TENANT_ID, role: 'child', joinedAt: '2026-01-01' },
		]);
		mockFindChildByUserId.mockResolvedValue({ id: 'c-1' });

		const context = await new CognitoAuthProvider().resolveContext(
			createEvent().event,
			googleIdentity,
		);

		expect(mockFindChildByUserId).toHaveBeenCalledWith(APP_USER_ID, TENANT_ID);
		expect(context?.childId).toBe('c-1');
	});

	it('context token が userId を往復させる', () => {
		const token = signContext({ tenantId: TENANT_ID, role: 'parent', userId: APP_USER_ID });
		expect(verifyContext(token)?.userId).toBe(APP_USER_ID);
		expect(getContextMaxAge({ tenantId: TENANT_ID, role: 'parent' })).toBeGreaterThan(0);
	});

	it('userId を持たない旧 token は採用せず membership から発行し直す', async () => {
		const { jar, event } = createEvent();
		// 旧形式 (userId 無し) の署名済 token を積む
		jar.set('context_token', signContext({ tenantId: TENANT_ID, role: 'parent' }));

		const context = await new CognitoAuthProvider().resolveContext(event, nativeIdentity);

		expect(context?.userId).toBe(APP_USER_ID);
		expect(mockFindUserByEmail).toHaveBeenCalledWith(EMAIL);
	});
});
