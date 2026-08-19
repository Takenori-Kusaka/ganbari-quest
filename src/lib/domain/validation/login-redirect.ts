// src/lib/domain/validation/login-redirect.ts
// ログイン後の戻り先 (`?next=`) と、ログイン画面に渡される状態 query の SSOT (#4701)。
//
// - `next`: 同一オリジンの相対パスのみ受け取り、password / Google 両経路のログイン後着地に使う。
//   open redirect 防止: 先頭 "/" 必須、直後の "/" と "\" を拒否 (ブラウザは Location の "\" を
//   "/" に正規化するため "/\evil.com" は protocol-relative "//evil.com" になる、#3025 QM 指摘)、
//   CR/LF 等の制御文字と絶対 URL (scheme) を拒否する。
// - 状態 query: 送り側 (signup / login confirm / OAuth callback / hooks) が付ける
//   `registered` / `confirmed` / `error` / `reason` / `passwordReset` を顧客向け文言にマップする。
//   送り側の値はここで列挙し、未知の値でも汎用文言で黙らない。

import { z } from 'zod';
import { LOGIN_LABELS } from '$lib/domain/labels';

/** ログイン後の戻り先として受け付ける query 名 (CTA 側もこれに統一する)。 */
export const LOGIN_NEXT_PARAM = 'next';

/** OAuth (Google) 経路で `next` を往復させる cookie 名 (`/auth/oauth/google` → `/auth/callback`)。 */
export const OAUTH_NEXT_COOKIE_NAME = 'oauth_next';

/**
 * `?next=` の値として URL に埋め込むための encode。パス区切り `/` は読みやすさのため残し、
 * `?` `&` `#` `=` 等は encode して入れ子 query (`/admin/activities?import=x`) が外側の query を壊さないようにする。
 */
export function encodeNextParam(path: string): string {
	return encodeURIComponent(path).replace(/%2F/gi, '/');
}

/** `/auth/login?next=<encoded>` を組み立てる (未ログイン CTA 側の SSOT)。 */
export function buildLoginHrefWithNext(path: string): string {
	return `/auth/login?${LOGIN_NEXT_PARAM}=${encodeNextParam(path)}`;
}

/** 相対パス (`/` 始まり、`//` `/\` 不可、制御文字不可、2KB 以内)。 */
export const safeNextPathSchema = z
	.string()
	.min(1)
	.max(2048)
	.regex(/^\/(?![/\\])/, 'next は同一オリジンの相対パスのみ')
	.regex(/^[^\r\n\0]*$/, 'next に制御文字は使えない');

/**
 * `next` 候補を検証し、安全な相対パスなら返す。それ以外 (外部 URL / `//evil` / 空 / 未指定) は null。
 * 呼び出し側は null のとき既定の着地 (`/admin` / `/switch`) を使う。
 */
export function resolveSafeNextPath(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	const parsed = safeNextPathSchema.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

/** ログイン画面に表示する状態 (成功系 = status / 失敗系 = alert)。 */
export type LoginNotice = { kind: 'status' | 'alert'; message: string; code: string };

/** OAuth callback が付ける `?error=` の値 (送り側 SSOT: src/routes/auth/callback/+server.ts)。 */
export const LOGIN_ERROR_CODES = {
	oauthFailed: 'oauth_failed',
	missingParams: 'missing_params',
	invalidState: 'invalid_state',
	tokenExchangeFailed: 'token_exchange_failed',
} as const;

/** hooks が付ける `?reason=` の値 (送り側 SSOT: src/hooks.server.ts terminated テナント)。 */
export const LOGIN_REASON_CODES = {
	deleted: 'deleted',
	/** #4699: 退会 (アカウント削除) 申請直後の着地。受付完了 + 猶予中は取り消せることを伝える */
	deletionPending: 'deletion_pending',
} as const;

/**
 * `/auth/login` の query から表示すべき通知を 1 件決める (優先: error > reason > 成功系)。
 * 何も該当しなければ null。
 */
export function resolveLoginNotice(params: URLSearchParams): LoginNotice | null {
	const error = params.get('error');
	if (error !== null) {
		const message =
			error === LOGIN_ERROR_CODES.oauthFailed
				? LOGIN_LABELS.noticeOauthFailed
				: error === LOGIN_ERROR_CODES.missingParams || error === LOGIN_ERROR_CODES.invalidState
					? LOGIN_LABELS.noticeOauthStateLost
					: error === LOGIN_ERROR_CODES.tokenExchangeFailed
						? LOGIN_LABELS.noticeOauthTokenExchangeFailed
						: LOGIN_LABELS.noticeLoginFailedGeneric;
		return { kind: 'alert', message, code: `error=${error}` };
	}
	const reason = params.get('reason');
	if (reason !== null) {
		// #4699: 退会申請の受付は「失敗」ではないので status (成功系) で出す
		if (reason === LOGIN_REASON_CODES.deletionPending) {
			return {
				kind: 'status',
				message: LOGIN_LABELS.noticeDeletionPending,
				code: `reason=${reason}`,
			};
		}
		const message =
			reason === LOGIN_REASON_CODES.deleted
				? LOGIN_LABELS.noticeAccountDeleted
				: LOGIN_LABELS.noticeLoginFailedGeneric;
		return { kind: 'alert', message, code: `reason=${reason}` };
	}
	if (params.get('passwordReset') === 'true') {
		return { kind: 'status', message: LOGIN_LABELS.passwordResetSuccess, code: 'passwordReset' };
	}
	if (params.get('registered') === 'true') {
		return { kind: 'status', message: LOGIN_LABELS.noticeRegistered, code: 'registered' };
	}
	if (params.get('confirmed') === 'true') {
		return { kind: 'status', message: LOGIN_LABELS.noticeConfirmed, code: 'confirmed' };
	}
	return null;
}
