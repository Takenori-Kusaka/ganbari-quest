// tests/unit/routes/auth-join-pending-membership.test.ts
// #4636: membership 未確定 (AuthUser はあるがテナント無し) の正規着地画面 `/auth/join` の回帰固定。
//
// 招待 / メンバーは local backend で起動できない (#3732) ため、page load / action を直接結線して
// 「理由の再導出 / dead-end 回避 / 明示作成の冪等性」を検証する。staging 実機手順は PR body 参照。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVITE_JOIN_BLOCKED_MESSAGES } from '../../../src/lib/domain/labels';
import { CONTEXT_COOKIE_NAME, INVITE_COOKIE_NAME } from '../../../src/lib/domain/validation/auth';

const mockFindUserByEmail = vi.fn();
const mockFindUserTenants = vi.fn();
const mockCreateUser = vi.fn();
const mockCreateTenant = vi.fn();
const mockCreateMembership = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findUserByEmail: mockFindUserByEmail,
			findUserTenants: mockFindUserTenants,
			createUser: mockCreateUser,
			createTenant: mockCreateTenant,
			createMembership: mockCreateMembership,
		},
	}),
}));

const mockPreview = vi.fn();
vi.mock('$lib/server/services/invite-service', () => ({
	previewInviteAcceptance: (...args: unknown[]) => mockPreview(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { actions, load } from '../../../src/routes/auth/join/+page.server';

// SvelteKit の Actions 型は index signature が optional。テストでは実装が定義済であることを前提に narrow する。
// biome-ignore lint/suspicious/noExplicitAny: Action の部分モック呼び出し
const createFamilyAction = actions.createFamily as (event: any) => unknown;

const identity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-1',
	email: 'invited@example.com',
	emailVerified: true,
};

function createCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => jar.set(name, value),
		delete: (name: string) => jar.delete(name),
	};
	// biome-ignore lint/suspicious/noExplicitAny: Cookies の部分モック
	return { jar, cookies: cookies as any };
}

/** redirect() は throw されるので catch して正規化する。 */
async function run<T>(fn: () => T | Promise<T>) {
	try {
		return { data: await fn() };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.location !== 'string') throw e;
		return { redirect: r };
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindUserByEmail.mockResolvedValue({ userId: 'u-1', email: identity.email });
	mockFindUserTenants.mockResolvedValue([]);
	mockCreateTenant.mockResolvedValue({ tenantId: 't-new' });
	mockCreateMembership.mockResolvedValue({ userId: 'u-1', tenantId: 't-new', role: 'owner' });
});

describe('#4636 /auth/join (membership 未確定の着地画面)', () => {
	it('招待 cookie から拒否理由を再導出して表示する (cookie の寿命に依存しない)', async () => {
		const { cookies } = createCookies({ [INVITE_COOKIE_NAME]: 'inv-1' });
		mockPreview.mockResolvedValue('INVITE_EMAIL_UNVERIFIED');

		const { data } = await run(() =>
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			load({ locals: { identity, context: null }, cookies } as any),
		);

		expect(data?.blockedReason).toBe('INVITE_EMAIL_UNVERIFIED');
		expect(data?.message).toBe(INVITE_JOIN_BLOCKED_MESSAGES.INVITE_EMAIL_UNVERIFIED);
		// 表示のたびに引き直せる = 一度読んだら消える one-shot cookie ではない
		expect(mockPreview).toHaveBeenCalledWith('inv-1', 'u-1', identity.email, {
			emailVerified: true,
		});
	});

	it('未知の理由でも汎用文言で黙らない', async () => {
		const { cookies } = createCookies({ [INVITE_COOKIE_NAME]: 'inv-1' });
		mockPreview.mockResolvedValue('SOMETHING_NEW');

		const { data } = await run(() =>
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			load({ locals: { identity, context: null }, cookies } as any),
		);

		expect(data?.message).toBeTruthy();
	});

	it('招待 cookie が無ければ理由なしで「新しく作る」導線だけを出す', async () => {
		const { cookies } = createCookies();

		const { data } = await run(() =>
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			load({ locals: { identity, context: null }, cookies } as any),
		);

		expect(data?.blockedReason).toBeNull();
		expect(data?.message).toBeNull();
		expect(mockPreview).not.toHaveBeenCalled();
	});

	it('受諾できる状態に戻っていれば /admin へ送り返す (自動合流)', async () => {
		const { cookies } = createCookies({ [INVITE_COOKIE_NAME]: 'inv-1' });
		mockPreview.mockResolvedValue(null);

		const { redirect } = await run(() =>
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			load({ locals: { identity, context: null }, cookies } as any),
		);

		expect(redirect?.location).toBe('/admin');
	});

	it('所属が確定済みのユーザーが来たら本来の画面へ戻す (dead-end / 無限ループにしない)', async () => {
		const { cookies } = createCookies();

		const parent = await run(() =>
			load({
				locals: { identity, context: { tenantId: 't-1', role: 'parent' } },
				cookies,
				// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			} as any),
		);
		expect(parent.redirect?.location).toBe('/admin');

		const child = await run(() =>
			load({
				locals: { identity, context: { tenantId: 't-1', role: 'child' } },
				cookies,
				// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			} as any),
		);
		expect(child.redirect?.location).toBe('/switch');
	});

	it('未ログインならログイン画面へ', async () => {
		const { cookies } = createCookies();

		const { redirect } = await run(() =>
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			load({ locals: { identity: null, context: null }, cookies } as any),
		);

		expect(redirect?.location).toBe('/auth/login');
	});

	describe('createFamily action (明示作成)', () => {
		it('家族グループを作り、招待 cookie と context cookie を破棄して /admin へ', async () => {
			const { jar, cookies } = createCookies({
				[INVITE_COOKIE_NAME]: 'inv-1',
				[CONTEXT_COOKIE_NAME]: 'stale',
			});

			const { redirect } = await run(() => createFamilyAction({ locals: { identity }, cookies }));

			expect(redirect?.location).toBe('/admin');
			expect(mockCreateTenant).toHaveBeenCalledTimes(1);
			expect(jar.has(INVITE_COOKIE_NAME)).toBe(false);
			expect(jar.has(CONTEXT_COOKIE_NAME)).toBe(false);
		});

		it('連打 / リロードで二重作成しない (冪等)', async () => {
			const { cookies } = createCookies();

			await run(() => createFamilyAction({ locals: { identity }, cookies }));
			// 2 回目は既に所属がある状態 (1 回目の作成結果)
			mockFindUserTenants.mockResolvedValue([{ userId: 'u-1', tenantId: 't-new', role: 'owner' }]);
			const second = await run(() => createFamilyAction({ locals: { identity }, cookies }));

			expect(second.redirect?.location).toBe('/admin');
			expect(mockCreateTenant).toHaveBeenCalledTimes(1);
		});

		it('作成に失敗したら画面にエラーを返す (握り潰さない)', async () => {
			const { cookies } = createCookies();
			mockCreateTenant.mockRejectedValue(new Error('db down'));

			const { data } = await run(() => createFamilyAction({ locals: { identity }, cookies }));

			expect((data as { status?: number })?.status).toBe(500);
			expect((data as { data?: { createFailed?: boolean } })?.data?.createFailed).toBe(true);
		});
	});
});
