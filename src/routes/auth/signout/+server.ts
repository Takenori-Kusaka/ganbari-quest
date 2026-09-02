// /auth/signout — Cognito セッション完全破棄 (#0197)
// Cookie削除 + Cognito Hosted UI ログアウトにリダイレクト

import { redirect } from '@sveltejs/kit';
import { LOGIN_REASON_CODES } from '$lib/domain/validation/login-redirect';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	buildLogoutUrl,
	revokeCognitoRefreshToken,
} from '$lib/server/auth/providers/cognito-oauth';
import { clearAuthSessionCookies } from '$lib/server/auth/session-cookies';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	// Cognito 本番モード: Refresh Token を失効させてから Cookie 削除 (#1365)
	if (getAuthMode() === 'cognito' && !isCognitoDevMode()) {
		await revokeCognitoRefreshToken(cookies);
	}

	// 全ての認証 Cookie をクリア (親ゲート PIN session を含む、#4700。一覧は session-cookies.ts SSOT)
	clearAuthSessionCookies(cookies);

	// Cognito 本番モードの場合は Cognito ログアウト URL にリダイレクト（dev モードは除外）
	if (getAuthMode() === 'cognito' && !isCognitoDevMode()) {
		redirect(302, buildLogoutUrl());
	}

	// ローカル or dev モードの場合はログインページへ。
	// #4699: 退会 (アカウント削除) 申請直後は理由を引き継ぎ、ログイン画面で受付完了を伝える
	// (既知の理由コードのみ通す。任意文字列を query に載せ替えない)。
	const reason = url.searchParams.get('reason');
	const known = Object.values(LOGIN_REASON_CODES).find((code) => code === reason);
	redirect(302, known ? `/auth/login?reason=${known}` : '/auth/login');
};
