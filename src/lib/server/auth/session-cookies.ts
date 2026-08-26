// src/lib/server/auth/session-cookies.ts
// ログアウト時に破棄する cookie 集合の SSOT (#4700)。
//
// 背景: /auth/signout と /auth/logout がそれぞれ 5 cookie (identity / context / session /
// invite / refresh) を個別に delete しており、親ゲート session cookie (`gq_parent_session`、
// ADR-0050) が両方から漏れていた。その結果、共有端末でログアウトしても 24 時間以内に同じ
// 家族の大人が再ログインすると PIN 無しで親画面に入れた (本番 cognito の PIN gate 前提が崩れる)。
// 「ログアウトで消すべき cookie」を 1 箇所に列挙し、両 handler はこれを呼ぶ。
// 網羅は tests/unit/auth/logout-clears-all-session-cookies.test.ts が固定する。

import type { Cookies } from '@sveltejs/kit';
import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	INVITE_COOKIE_NAME,
	REFRESH_COOKIE_NAME,
	SESSION_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { PARENT_SESSION_COOKIE_NAME } from '$lib/server/services/parent-gate-session';

/**
 * ログアウトで破棄する cookie 名の一覧 (path=/ で set されるもの)。
 * 新しいセッション系 cookie を足したら、ここに追加する (個別 handler に直書きしない)。
 */
export const LOGOUT_CLEARED_COOKIE_NAMES = [
	IDENTITY_COOKIE_NAME,
	CONTEXT_COOKIE_NAME,
	SESSION_COOKIE_NAME,
	INVITE_COOKIE_NAME, // #0203: 残留防止
	REFRESH_COOKIE_NAME, // #1365: Refresh Token も削除
	PARENT_SESSION_COOKIE_NAME, // #4700: 親ゲート PIN session も破棄 (ADR-0050)
] as const;

/** ログアウト時の cookie 一括破棄。/auth/signout と /auth/logout の共通処理。 */
export function clearAuthSessionCookies(cookies: Cookies): void {
	for (const name of LOGOUT_CLEARED_COOKIE_NAMES) {
		cookies.delete(name, { path: '/' });
	}
}
