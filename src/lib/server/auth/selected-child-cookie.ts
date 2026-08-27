// src/lib/server/auth/selected-child-cookie.ts
// 「いまどの子供として使っているか」を覚えておく cookie の SSOT (#4641)。
//
// 書き手が `/switch` の select action と `(child)/+layout.server.ts` に分かれており、
// #4641 でログイン直後の着地決定も書き手に加わった。属性 (path / httpOnly / 有効期限) が
// 書き手ごとにずれると「書いたのに次のリクエストで読めない」が起きるため 1 箇所に集約する。

import type { Cookies } from '@sveltejs/kit';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { COOKIE_SECURE } from '$lib/server/cookie-config';

export const SELECTED_CHILD_COOKIE = 'selectedChildId';

/** 1 年。子供が毎回選び直さなくてよいだけの寿命 (機微情報は持たない id のみ)。 */
const SELECTED_CHILD_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** cookie に残っている選択済みの子供 id (未選択なら null)。 */
export function readSelectedChildId(cookies: Cookies): ChildId | null {
	const raw = cookies.get(SELECTED_CHILD_COOKIE);
	return raw ? asChildId(raw) : null;
}

/** 選択中の子供を固定する。 */
export function setSelectedChildCookie(cookies: Cookies, childId: ChildId | string): void {
	cookies.set(SELECTED_CHILD_COOKIE, String(childId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: COOKIE_SECURE,
		maxAge: SELECTED_CHILD_COOKIE_MAX_AGE,
	});
}
