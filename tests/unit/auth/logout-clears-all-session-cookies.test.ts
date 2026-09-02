// tests/unit/auth/logout-clears-all-session-cookies.test.ts
// #4700: ログアウト (/auth/logout, /auth/signout) が親ゲート PIN session cookie
// (`gq_parent_session`、ADR-0050) を含む全セッション cookie を破棄することを固定する。
//
// 旧実装は両 handler が 5 cookie を個別に delete しており、gq_parent_session が漏れていた。
// 共有端末でログアウトしても 24 時間以内に同じ家族の大人が再ログインすると PIN 無しで親画面に
// 入れた (本番 cognito の PIN gate 前提が崩れる)。破棄対象は
// `src/lib/server/auth/session-cookies.ts` の LOGOUT_CLEARED_COOKIE_NAMES (SSOT) に一本化し、
// 両 handler がそれを経由することを実 handler 呼び出しで検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
	isCognitoDevMode: () => true,
}));
vi.mock('$lib/server/auth/providers/cognito-oauth', () => ({
	buildLogoutUrl: () => 'http://localhost/logout',
	revokeCognitoRefreshToken: vi.fn(),
}));

const { LOGOUT_CLEARED_COOKIE_NAMES, clearAuthSessionCookies } = await import(
	'../../../src/lib/server/auth/session-cookies'
);
const { PARENT_SESSION_COOKIE_NAME } = await import(
	'../../../src/lib/server/services/parent-gate-session'
);
const { CONTEXT_COOKIE_NAME, IDENTITY_COOKIE_NAME, REFRESH_COOKIE_NAME } = await import(
	'../../../src/lib/domain/validation/auth'
);
const logoutRoute = await import('../../../src/routes/auth/logout/+server');
const signoutRoute = await import('../../../src/routes/auth/signout/+server');

function makeCookies() {
	const deleted: string[] = [];
	const cookies = {
		delete: vi.fn((name: string, _opts?: { path?: string }) => {
			deleted.push(name);
		}),
		get: vi.fn(() => undefined),
		set: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	};
	return { cookies, deleted };
}

/** SvelteKit の redirect() は throw するので、呼び出しを包んで「redirect したこと」だけ確認する */
async function runExpectingRedirect(fn: () => unknown) {
	try {
		await fn();
	} catch (e) {
		expect(e, 'redirect() の throw であること').toMatchObject({ status: 302 });
		return;
	}
	throw new Error('handler は redirect で終わるはず');
}

describe('#4700 ログアウトは親ゲート PIN session を含む全セッション cookie を破棄する', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('LOGOUT_CLEARED_COOKIE_NAMES (SSOT) は identity / context / refresh / parent session を含む', () => {
		expect(LOGOUT_CLEARED_COOKIE_NAMES).toEqual(
			expect.arrayContaining([
				IDENTITY_COOKIE_NAME,
				CONTEXT_COOKIE_NAME,
				REFRESH_COOKIE_NAME,
				PARENT_SESSION_COOKIE_NAME,
			]),
		);
		// 重複なし (同じ cookie を 2 回 delete する無駄・typo 検出)
		expect(new Set(LOGOUT_CLEARED_COOKIE_NAMES).size).toBe(LOGOUT_CLEARED_COOKIE_NAMES.length);
	});

	it('clearAuthSessionCookies は SSOT の全 cookie を path=/ で delete する', () => {
		const { cookies, deleted } = makeCookies();
		clearAuthSessionCookies(cookies as never);
		expect(deleted).toEqual([...LOGOUT_CLEARED_COOKIE_NAMES]);
		for (const call of cookies.delete.mock.calls) {
			expect(call[1]).toEqual({ path: '/' });
		}
	});

	it('/auth/logout (GET / POST) は gq_parent_session を delete する', async () => {
		for (const handler of [logoutRoute.GET, logoutRoute.POST]) {
			const { cookies, deleted } = makeCookies();
			await runExpectingRedirect(() => handler({ cookies } as never));
			expect(deleted).toContain(PARENT_SESSION_COOKIE_NAME);
			expect(deleted).toEqual(expect.arrayContaining([...LOGOUT_CLEARED_COOKIE_NAMES]));
		}
	});

	it('/auth/signout (GET) は gq_parent_session を delete する', async () => {
		const { cookies, deleted } = makeCookies();
		// #4699 で signout は url.searchParams の reason を読むようになったため、
		// SvelteKit が常に渡す url を fake event にも持たせる (実 handler の契約に合わせる)
		const url = new URL('http://localhost/auth/signout');
		await runExpectingRedirect(() => signoutRoute.GET({ cookies, url } as never));
		expect(deleted).toContain(PARENT_SESSION_COOKIE_NAME);
		expect(deleted).toEqual(expect.arrayContaining([...LOGOUT_CLEARED_COOKIE_NAMES]));
	});
});
