// /auth/signout — Cognito セッション完全破棄 (#0197)
// Cookie削除 + Cognito Hosted UI ログアウトにリダイレクト

import { redirect } from '@sveltejs/kit';
import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	INVITE_COOKIE_NAME,
	REFRESH_COOKIE_NAME,
	SESSION_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	buildLogoutUrl,
	revokeCognitoRefreshToken,
} from '$lib/server/auth/providers/cognito-oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	// Cognito 本番モード: Refresh Token を失効させてから Cookie 削除 (#1365)
	if (getAuthMode() === 'cognito' && !isCognitoDevMode()) {
		await revokeCognitoRefreshToken(cookies);
	}

	// 全ての認証 Cookie をクリア
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	cookies.delete(INVITE_COOKIE_NAME, { path: '/' }); // #0203: 残留防止
	cookies.delete(REFRESH_COOKIE_NAME, { path: '/' }); // #1365: Refresh Token も削除

	// Cognito 本番モードの場合は Cognito ログアウト URL にリダイレクト（dev モードは除外）
	if (getAuthMode() === 'cognito' && !isCognitoDevMode()) {
		redirect(302, buildLogoutUrl());
	}

	// ローカル or dev モードの場合はログインページへ
	redirect(302, '/auth/login');
};
