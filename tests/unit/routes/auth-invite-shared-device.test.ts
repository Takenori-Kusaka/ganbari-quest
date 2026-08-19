// tests/unit/routes/auth-invite-shared-device.test.ts
// #4049: 家庭内共有端末での「親ログイン中 → 子の招待リンク → ログアウト → 招待リンク再クリック
// → 子として新規登録」経路の回帰固定。
//
// 招待 (invites) / メンバー (memberships) 系は local backend では起動できない (#3732) ため、
// 実装モジュール (invite page load / logout handler / CognitoAuthProvider) を直接結線して
// cookie 分岐と参加先テナントを integration レベルで検証する。
// staging 実機検証手順は PR body 参照。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_INVITE_LABELS } from '../../../src/lib/domain/labels';
import { INVITE_COOKIE_NAME } from '../../../src/lib/domain/validation/auth';

// --- repos モック (in-memory auth repo 相当) ---

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

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
	isCognitoDevMode: () => true,
}));

vi.mock('$lib/server/auth/providers/cognito-oauth', () => ({
	buildLogoutUrl: () => 'https://example.invalid/logout',
	revokeCognitoRefreshToken: vi.fn(),
	refreshCognitoIdToken: vi.fn(async () => null),
}));

vi.mock('$lib/server/auth/providers/cognito-jwt', () => ({
	verifyIdentityToken: vi.fn(async () => null),
}));

import { CognitoAuthProvider } from '../../../src/lib/server/auth/providers/cognito';
import { load as inviteLoad } from '../../../src/routes/auth/invite/[code]/+page.server';
import { GET as logoutGet } from '../../../src/routes/auth/logout/+server';

const INVITE_CODE = 'inv-shared-device-4049';
const INVITING_TENANT_ID = 't-inviting-family';

/** 端末 1 台分の cookie jar (load / logout / provider 間で共有する)。 */
function createBrowser() {
	const jar = new Map<string, string>();
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => {
			jar.set(name, value);
		},
		delete: (name: string) => {
			jar.delete(name);
		},
		getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
		serialize: () => '',
	};
	// biome-ignore lint/suspicious/noExplicitAny: RequestEvent の部分モック
	return { jar, cookies: cookies as any };
}

/**
 * redirect() は throw されるので catch して結果を正規化する。
 *
 * #4643: 「既に別グループ所属」は解決済 context の有無で判定する (旧実装は IdP の sub で
 * findUserTenants を引いており、所属済でも必ず 0 件になっていた)。
 */
async function runLoad(
	browser: ReturnType<typeof createBrowser>,
	identity: unknown,
	context: unknown = null,
) {
	try {
		return {
			data: await inviteLoad({
				params: { code: INVITE_CODE },
				cookies: browser.cookies,
				locals: { identity, context },
				// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			} as any),
		};
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.location !== 'string') throw e;
		return { redirect: r };
	}
}

const parentIdentity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-parent',
	email: 'parent@example.com',
	emailVerified: true,
};

const childIdentity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-child',
	email: 'child@example.com',
	emailVerified: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGetInvite.mockResolvedValue({
		inviteId: 'i-1',
		tenantId: INVITING_TENANT_ID,
		role: 'child',
		childId: undefined,
		email: undefined,
		expiresAt: new Date(Date.now() + 86400_000).toISOString(),
		status: 'pending',
	});
	mockFindTenantById.mockResolvedValue({ tenantId: INVITING_TENANT_ID, status: 'active' });
	mockFindUserByEmail.mockResolvedValue(null);
	mockFindUserTenants.mockResolvedValue([]);
	mockCreateUser.mockResolvedValue({ userId: 'u-child', email: childIdentity.email });
	mockFindChildByUserId.mockResolvedValue(null);
	mockAcceptInvite.mockResolvedValue({
		membership: { userId: 'u-child', tenantId: INVITING_TENANT_ID, role: 'child' },
	});
});

describe('#4049 招待リンク × 家庭内共有端末', () => {
	describe('AC1 / AC3: ログイン中に招待リンクを踏んだときの案内', () => {
		it('既に別グループ所属のエラーは専用 errorDesc を返し、ログアウト → 招待リンク再タップを案内する', async () => {
			const browser = createBrowser();
			browser.jar.set(INVITE_COOKIE_NAME, 'stale-code');

			const { data } = await runLoad(browser, parentIdentity, {
				tenantId: 't-parent-family',
				role: 'owner',
				userId: 'u-parent',
			});

			expect(data).toBeDefined();
			expect(data?.valid).toBe(false);
			// errorDesc が undefined だと画面が invalidLinkDesc (リンク再発行の案内) に
			// フォールバックし、本経路で必要な「ログアウト」案内が消える (#4049 真因 1)
			expect(data?.errorDesc).toBe(AUTH_INVITE_LABELS.alreadyInTenantDesc);
			expect(data?.errorDesc).toContain('ログアウト');
			expect(data?.errorDesc).toContain('招待リンク');
			expect(data?.error).toBe(AUTH_INVITE_LABELS.alreadyInTenant);
			// AC3: 画面が「ログアウトする」導線を出すためのフラグ
			expect(data?.sessionActive).toBe(true);
			// #0203: 残留防止として招待 Cookie は削除されたままにする
			expect(browser.jar.has(INVITE_COOKIE_NAME)).toBe(false);
		});

		it('email 不一致のエラーでもログイン中なのでログアウト導線を出す', async () => {
			const browser = createBrowser();
			mockGetInvite.mockResolvedValue({
				inviteId: 'i-2',
				tenantId: INVITING_TENANT_ID,
				role: 'child',
				email: 'someone-else@example.com',
				expiresAt: new Date(Date.now() + 86400_000).toISOString(),
				status: 'pending',
			});

			const { data } = await runLoad(browser, parentIdentity);

			expect(data?.valid).toBe(false);
			expect(data?.error).toBe(AUTH_INVITE_LABELS.emailMismatch);
			expect(data?.errorDesc).toBe(AUTH_INVITE_LABELS.emailMismatchDesc);
			expect(data?.sessionActive).toBe(true);
		});

		it('無効・期限切れリンクは未ログイン扱いのままログアウト導線を出さない', async () => {
			const browser = createBrowser();
			mockGetInvite.mockResolvedValue(null);

			const { data } = await runLoad(browser, parentIdentity);

			expect(data?.valid).toBe(false);
			expect(data?.error).toBe(AUTH_INVITE_LABELS.invalidLink);
			expect(data?.sessionActive).toBe(false);
		});
	});

	describe('AC2: 共有端末シナリオ (親ログイン → 招待 → ログアウト → 招待再クリック → 子として登録)', () => {
		it('再クリックした招待リンク経由なら招待元テナントに child として参加する', async () => {
			const browser = createBrowser();

			// 1. 親がログイン中の端末で招待リンクを開く → 警告 + Cookie 削除 (#0203)
			const first = await runLoad(browser, parentIdentity, {
				tenantId: 't-parent-family',
				role: 'owner',
				userId: 'u-parent',
			});
			expect(first.data?.valid).toBe(false);
			expect(browser.jar.has(INVITE_COOKIE_NAME)).toBe(false);

			// 2. 案内に従ってログアウト (#0203 の Cookie クリーンアップは維持する)
			browser.jar.set('identity_token', 'parent-token');
			await expect(
				// biome-ignore lint/suspicious/noExplicitAny: RequestHandler の部分モック
				logoutGet({ cookies: browser.cookies } as any),
			).rejects.toMatchObject({ status: 302 });
			expect(browser.jar.has('identity_token')).toBe(false);
			expect(browser.jar.has(INVITE_COOKIE_NAME)).toBe(false);

			// 3. 案内どおり招待リンクを再タップ → 未ログインなので Cookie が積まれる
			mockFindUserTenants.mockResolvedValue([]);
			const second = await runLoad(browser, null);
			expect(second.data?.valid).toBe(true);
			expect(browser.jar.get(INVITE_COOKIE_NAME)).toBe(INVITE_CODE);

			// 4. 子供用アカウントでサインアップ完了 → Context 解決で招待が受諾される
			const provider = new CognitoAuthProvider();
			const context = await provider.resolveContext(
				// biome-ignore lint/suspicious/noExplicitAny: RequestEvent の部分モック
				{ cookies: browser.cookies, url: new URL('http://localhost/admin') } as any,
				childIdentity,
			);

			expect(mockAcceptInvite).toHaveBeenCalledWith(
				INVITE_CODE,
				expect.any(String),
				childIdentity.email,
				expect.objectContaining({ emailVerified: true }),
			);
			expect(context?.tenantId).toBe(INVITING_TENANT_ID);
			expect(context?.role).toBe('child');
			// 新しい家族グループを勝手に作って owner にしない (#4049 真因 2)
			expect(mockCreateTenant).not.toHaveBeenCalled();
		});

		it('招待リンクを再クリックせずサインアップすると新規テナント owner になる (再クリック必須の根拠)', async () => {
			const browser = createBrowser();
			mockCreateTenant.mockResolvedValue({ tenantId: 't-new-family' });
			mockCreateMembership.mockResolvedValue({
				userId: 'u-child',
				tenantId: 't-new-family',
				role: 'owner',
			});
			mockFindTenantById.mockResolvedValue({ tenantId: 't-new-family', status: 'active' });

			const provider = new CognitoAuthProvider();
			const context = await provider.resolveContext(
				// biome-ignore lint/suspicious/noExplicitAny: RequestEvent の部分モック
				{ cookies: browser.cookies, url: new URL('http://localhost/admin') } as any,
				childIdentity,
			);

			expect(mockAcceptInvite).not.toHaveBeenCalled();
			expect(context?.role).toBe('owner');
			expect(context?.tenantId).toBe('t-new-family');
		});
	});
});
