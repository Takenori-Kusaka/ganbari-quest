// tests/unit/routes/auth-invite-relocation.test.ts
// #4642: `/auth/invite/[code]` の引っ越し合流 (別の家族グループへ移る) の画面側契約。
//
// **不可逆操作**なので、(a) 確認画面を出すだけで load 時には何も実行しない、
// (b) 同意チェック無しでは実行しない、(c) 可否はサーバー側で再検証する、を固定する。
// 招待・メンバーは local backend で起動できない (#3732) ため load / action を直接結線する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUTH_INVITE_LABELS,
	getInviteJoinBlockedMessage,
	INVITE_RELOCATION_LABELS,
} from '../../../src/lib/domain/labels';
import { CANCEL_TERMS } from '../../../src/lib/domain/terms';
import { CONTEXT_COOKIE_NAME, INVITE_COOKIE_NAME } from '../../../src/lib/domain/validation/auth';

const mockGetInvite = vi.fn();
vi.mock('$lib/server/services/invite-service', () => ({
	getInvite: (...args: unknown[]) => mockGetInvite(...args),
}));

const mockCheckEligibility = vi.fn();
const mockRelocate = vi.fn();
vi.mock('$lib/server/services/tenant-relocation-service', () => ({
	checkRelocationEligibility: (...args: unknown[]) => mockCheckEligibility(...args),
	relocateToInvitedTenant: (...args: unknown[]) => mockRelocate(...args),
}));

import { actions, load } from '../../../src/routes/auth/invite/[code]/+page.server';

const CODE = 'inv-relocate-4642';
const APP_USER_ID = 'u-mover';

const identity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-mover',
	email: 'mover@example.com',
	emailVerified: true,
};
const context = { tenantId: 't-own', role: 'owner' as const, userId: APP_USER_ID };

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

function createFormRequest(fields: Record<string, string>): Request {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.append(k, v);
	return new Request('http://localhost/auth/invite/x', { method: 'POST', body });
}

async function run<T>(fn: () => T | Promise<T>) {
	try {
		return { data: await fn() };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.location !== 'string') throw e;
		return { redirect: r };
	}
}

// biome-ignore lint/suspicious/noExplicitAny: Action の部分モック呼び出し
const relocateAction = actions.relocate as (event: any) => unknown;

beforeEach(() => {
	vi.clearAllMocks();
	mockGetInvite.mockResolvedValue({
		inviteId: 'i-1',
		tenantId: 't-invited',
		role: 'parent',
		expiresAt: new Date(Date.now() + 86400_000).toISOString(),
		status: 'pending',
	});
	mockCheckEligibility.mockResolvedValue({ currentTenantId: 't-own', blockedReason: null });
	mockRelocate.mockResolvedValue({
		ok: true,
		membership: { userId: APP_USER_ID, tenantId: 't-invited', role: 'parent' },
		deletedTenantId: 't-own',
	});
});

describe('#4642 引っ越し合流の確認画面 (load)', () => {
	it('自分ひとりの家族グループの owner には確認画面を出し、何も実行しない', async () => {
		const { cookies } = createCookies({ [INVITE_COOKIE_NAME]: CODE });

		const { data } = await run(() =>
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			load({ params: { code: CODE }, cookies, locals: { identity, context } } as any),
		);

		expect(data?.relocation).toBe(true);
		expect(data?.errorDesc).toBe(INVITE_RELOCATION_LABELS.lead);
		expect(mockRelocate).not.toHaveBeenCalled();
		// 招待 Cookie は積み直さない (別経路で無断合流させない)
		expect(mockCheckEligibility).toHaveBeenCalledWith(APP_USER_ID);
	});

	it('他メンバーが居る場合は合流させず、理由ごとの次アクションを出す', async () => {
		mockCheckEligibility.mockResolvedValue({
			currentTenantId: 't-own',
			blockedReason: 'HAS_OTHER_MEMBERS',
		});
		const { cookies } = createCookies();

		const { data } = await run(() =>
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
			load({ params: { code: CODE }, cookies, locals: { identity, context } } as any),
		);

		expect(data?.relocation).toBe(false);
		expect(data?.error).toBe(AUTH_INVITE_LABELS.alreadyInTenant);
		expect(data?.errorDesc).toBe(INVITE_RELOCATION_LABELS.blockedHasOtherMembers);
	});

	it('owner でないメンバーには「先に抜ける」導線を出す', async () => {
		mockCheckEligibility.mockResolvedValue({
			currentTenantId: 't-own',
			blockedReason: 'NOT_OWNER',
		});
		const { cookies } = createCookies();

		const event = {
			params: { code: CODE },
			cookies,
			locals: { identity, context: { ...context, role: 'parent' } },
			// biome-ignore lint/suspicious/noExplicitAny: PageServerLoad の部分モック
		} as any;
		const { data } = await run(() => load(event));

		expect(data?.errorDesc).toBe(INVITE_RELOCATION_LABELS.blockedNotOwner);
	});
});

describe('#4642 引っ越し合流の実行 (action)', () => {
	it('同意チェックが無ければ実行しない', async () => {
		const { cookies } = createCookies();

		const { data } = await run(() =>
			relocateAction({
				params: { code: CODE },
				cookies,
				locals: { identity, context },
				request: createFormRequest({ confirmText: CANCEL_TERMS.confirmPhrase }),
			}),
		);

		expect((data as { status?: number })?.status).toBe(400);
		expect((data as { data?: { relocateError?: string } })?.data?.relocateError).toBe(
			INVITE_RELOCATION_LABELS.acknowledgeRequired,
		);
		expect(mockRelocate).not.toHaveBeenCalled();
	});

	// #4642 PO 差し戻し: 退会と結果が同じ (家族グループの物理削除) なので確認語の入力も要求する。
	// 画面側の disabled だけに頼らず、サーバーでも同じ 2 条件を検証する。
	it('確認語の入力が無ければ実行しない (チェックだけでは通さない)', async () => {
		const { cookies } = createCookies();

		const { data } = await run(() =>
			relocateAction({
				params: { code: CODE },
				cookies,
				locals: { identity, context },
				request: createFormRequest({ acknowledge: 'on' }),
			}),
		);

		expect((data as { status?: number })?.status).toBe(400);
		expect((data as { data?: { relocateError?: string } })?.data?.relocateError).toBe(
			INVITE_RELOCATION_LABELS.confirmInputMismatch,
		);
		expect(mockRelocate).not.toHaveBeenCalled();
	});

	it('確認語が一字でも違えば実行しない', async () => {
		const { cookies } = createCookies();

		const { data } = await run(() =>
			relocateAction({
				params: { code: CODE },
				cookies,
				locals: { identity, context },
				request: createFormRequest({ acknowledge: 'on', confirmText: 'アカウントを削除する' }),
			}),
		);

		expect((data as { status?: number })?.status).toBe(400);
		expect(mockRelocate).not.toHaveBeenCalled();
	});

	it('確認語は退会と同じ atom を使う (経路ごとに別の語を置かない)', () => {
		expect(INVITE_RELOCATION_LABELS.confirmInputPlaceholder).toBe(CANCEL_TERMS.confirmPhrase);
		expect(INVITE_RELOCATION_LABELS.confirmInputLabel).toContain(CANCEL_TERMS.confirmPhrase);
	});

	it('同意があれば実行し、context / 招待 Cookie を破棄して /admin へ', async () => {
		const { jar, cookies } = createCookies({
			[INVITE_COOKIE_NAME]: CODE,
			[CONTEXT_COOKIE_NAME]: 'stale',
		});

		const { redirect } = await run(() =>
			relocateAction({
				params: { code: CODE },
				cookies,
				locals: { identity, context },
				request: createFormRequest({
					acknowledge: 'on',
					confirmText: CANCEL_TERMS.confirmPhrase,
				}),
			}),
		);

		expect(redirect?.location).toBe('/admin');
		expect(mockRelocate).toHaveBeenCalledWith(CODE, APP_USER_ID, identity.email, {
			emailVerified: true,
		});
		expect(jar.has(CONTEXT_COOKIE_NAME)).toBe(false);
		expect(jar.has(INVITE_COOKIE_NAME)).toBe(false);
	});

	it('サーバー側の再検証で弾かれたら理由を返す (画面の同意だけを信用しない)', async () => {
		mockRelocate.mockResolvedValue({ ok: false, blockedReason: 'HAS_OTHER_MEMBERS' });
		const { cookies } = createCookies();

		const { data } = await run(() =>
			relocateAction({
				params: { code: CODE },
				cookies,
				locals: { identity, context },
				request: createFormRequest({
					acknowledge: 'on',
					confirmText: CANCEL_TERMS.confirmPhrase,
				}),
			}),
		);

		expect((data as { data?: { relocateError?: string } })?.data?.relocateError).toBe(
			INVITE_RELOCATION_LABELS.blockedHasOtherMembers,
		);
	});

	it('受諾が拒否されたら理由ごとの文言を返す (元の家族グループは残る)', async () => {
		mockRelocate.mockResolvedValue({ ok: false, acceptError: 'INVITE_EMAIL_MISMATCH' });
		const { cookies } = createCookies();

		const { data } = await run(() =>
			relocateAction({
				params: { code: CODE },
				cookies,
				locals: { identity, context },
				request: createFormRequest({
					acknowledge: 'on',
					confirmText: CANCEL_TERMS.confirmPhrase,
				}),
			}),
		);

		expect((data as { data?: { relocateError?: string } })?.data?.relocateError).toBe(
			getInviteJoinBlockedMessage('INVITE_EMAIL_MISMATCH'),
		);
	});
});
