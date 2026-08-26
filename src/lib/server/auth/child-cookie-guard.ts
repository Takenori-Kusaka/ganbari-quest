// src/lib/server/auth/child-cookie-guard.ts
// #3581 ②: POST action の trust 境界 (selectedChildId cookie) 形式検証。
//
// child 配下の GET load は `(child)/+layout.server.ts` の getChildById gate が stale cookie を
// 「undefined → cookie delete + /switch redirect」で正規化する。だが **form action は同 layout
// load を経ずに実行される**ため、生の cookie id が repo に直達し、dsql backend では uuid 列 WHERE で
// 22P02 (invalid input syntax for type uuid) → 500 になる (CWE-20)。
//
// 本 guard を action 冒頭で呼び、layout と同一契約 (cookie delete + /switch redirect) に正規化する。
// sqlite / demo / dynamodb backend の id は数値文字列 ('903' 等) が正当なため、uuid 形式検証は
// **dsql backend でのみ**行う (それ以外の backend で有効な数値 id を誤って弾かない)。

import { type Cookies, redirect } from '@sveltejs/kit';
import { isPgBackend } from '$lib/server/db/backend';
import { isUuidFormat, warnInvalidUuidId } from '$lib/server/db/dsql/pg-uuid';

/**
 * POST action 冒頭で `selectedChildId` cookie の形式を検証する。
 *
 * dsql backend で cookie が uuid 形式でない (空 or stale な旧数値 id 等) 場合、その id は
 * uuid 列 WHERE に渡すと 22P02 を起こすため、cookie を削除して `/switch` へ redirect する
 * (layout の stale cookie 処理と同契約)。**redirect は throw される**ため、呼び出し後の
 * コードは有効な形式の cookie でのみ到達する。
 *
 * 非 dsql backend では何もしない (数値 id が正当なため各 action の既存 empty-cookie 処理に委ねる)。
 *
 * @param cookies SvelteKit の Cookies。
 * @param source 監視用の識別子 (例 `'route.checklist.toggle'`)。stale cookie 検知の warn に使う。
 * @returns 有効な形式の `selectedChildId` 文字列 (呼び出し側で asChildId 等に渡せる)。
 */
export function requireValidChildCookieFormat(cookies: Cookies, source: string): string {
	const childIdStr = cookies.get('selectedChildId') ?? '';
	// pg 系 (dsql / pglite) 以外 (sqlite / demo) は数値 id が正当なため形式検証しない (#4720: NUC PGlite も対象)。
	if (!isPgBackend()) return childIdStr;
	if (isUuidFormat(childIdStr)) return childIdStr;
	// 非空だが非 uuid の stale id のみ warn (空 cookie = 単なる未選択なので breadcrumb 不要)。
	if (childIdStr) warnInvalidUuidId(source);
	cookies.delete('selectedChildId', { path: '/' });
	redirect(302, '/switch');
}
