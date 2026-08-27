// src/lib/domain/validation/login-redirect.ts
// ログイン後の戻り先 (`?next=`) と、ログイン画面に渡される状態 query の SSOT (#4701)。
//
// - `next`: 同一オリジンの相対パスのみ受け取り、password / Google 両経路のログイン後着地に使う。
//   open redirect 防止は 3 段: ① 先頭 "/" 必須 + 直後の "/" と "\" を拒否 (ブラウザは Location の
//   "\" を "/" に正規化するため "/\evil.com" は protocol-relative "//evil.com" になる、#3025 QM 指摘)
//   ② 許可文字の allowlist (制御文字 / 空白 / 非 ASCII を排除) ③ percent-decode + 正規化後の再検査。
//   ① だけでは "/<TAB>//evil.com" のように 1 文字挟むだけで抜けられる (PR #4743 QM review fix)。
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

/**
 * 相対パスに現れてよい文字 **以外** (1 文字でも含めば拒否する)。
 * 許可するのは RFC 3986 の unreserved (`A-Za-z0-9-._~`) + sub-delims (`!$&'()*+,;=`) +
 * pchar の `:` `@` + 区切り `/` `?` `#` + percent-encoding の `%`。
 *
 * deny list ではなく allowlist にする理由: 先頭 2 文字だけを見る `^\/(?![/\\])` は、間に
 * 1 文字挟むだけですり抜ける (`/<TAB>//evil.com`)。Location ヘッダやブラウザの正規化で
 * その 1 文字が除去されると protocol-relative `//evil.com` に縮退し、外部サイトへ飛ぶ。
 * 「危険な文字」を数え上げる方式は C0 / C1 / Unicode 行区切り / BOM と取りこぼしが続くため、
 * 許可する文字を positive に定義する。非 ASCII は Location ヘッダに載せられないので、
 * 送り側 (encodeNextParam) が percent-encode した形だけを受け取る。
 */
const DISALLOWED_NEXT_PATH_CHAR = /[^A-Za-z0-9._~%!$&'()*+,;=:@/?#-]/;

/**
 * 正規化で消える文字の code point 範囲 (C0 制御文字 + 半角スペース / DEL + C1 制御文字 +
 * NBSP / Unicode 行区切り / BOM)。regex リテラルに直接書くと制御文字が生のまま source に
 * 載り、editor / lint / diff で黙って消えるため範囲で持つ。
 */
const STRIPPED_ON_NORMALIZE_RANGES = [
	[0x00, 0x20],
	[0x7f, 0xa0],
	[0x2028, 0x2029],
	[0xfeff, 0xfeff],
] as const;

function isStrippedOnNormalize(char: string): boolean {
	const code = char.charCodeAt(0);
	return STRIPPED_ON_NORMALIZE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/**
 * well-formed な `%XX` だけを復号する。`decodeURIComponent` と違い、
 * `50%` のような裸の `%` を含むパスで throw しない (throw を握り潰すと正常系まで落ちる)。
 */
function decodePercentPairs(path: string): string {
	return path.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	);
}

/**
 * percent-decode + 正規化除去を通しても相対パスのままか。
 * `/%09//evil.com` のように「encode した制御文字」経由で `//evil.com` へ縮退する経路を塞ぐ。
 */
function staysRelativeAfterNormalize(path: string): boolean {
	const normalized = [...decodePercentPairs(path)]
		.filter((c) => !isStrippedOnNormalize(c))
		.join('');
	return /^\/(?![/\\])/.test(normalized);
}

/** 相対パス (`/` 始まり、`//` `/\` 不可、許可文字のみ、正規化後も相対、2KB 以内)。 */
export const safeNextPathSchema = z
	.string()
	.min(1)
	.max(2048)
	.regex(/^\/(?![/\\])/, 'next は同一オリジンの相対パスのみ')
	.refine((p) => !DISALLOWED_NEXT_PATH_CHAR.test(p), 'next に使えない文字が含まれている')
	.refine(staysRelativeAfterNormalize, 'next は正規化後も同一オリジンの相対パスである必要がある');

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
