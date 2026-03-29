// /auth/signout — Cognito セッション完全破棄 (#0197)
// Cookie削除 + Cognito Hosted UI ログアウトにリダイレクト

import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	INVITE_COOKIE_NAME,
	SESSION_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import { buildLogoutUrl } from '$lib/server/auth/providers/cognito-oauth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	// 全ての認証 Cookie をクリア
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	cookies.delete(INVITE_COOKIE_NAME, { path: '/' }); // #0203: 残留防止

	// Cognito 本番モードの場合は Cognito ログアウト URL にリダイレクト（dev モードは除外）
	if (getAuthMode() === 'cognito' && !isCognitoDevMode()) {
		redirect(302, buildLogoutUrl());
	}

	// ローカル or dev モードの場合はログインページへ
	redirect(302, '/auth/login');
};
