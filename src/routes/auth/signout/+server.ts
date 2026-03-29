// /auth/signout — Cognito セッション完全破棄 (#0197)
// Cookie削除 + Cognito Hosted UI ログアウトにリダイレクト

import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	SESSION_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { getAuthMode } from '$lib/server/auth/factory';
import { buildLogoutUrl } from '$lib/server/auth/providers/cognito-oauth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	// 全ての認証 Cookie をクリア
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });

	// Cognito モードの場合は Cognito ログアウト URL にリダイレクト
	if (getAuthMode() === 'cognito') {
		const logoutUrl = buildLogoutUrl();
		redirect(302, logoutUrl);
	}

	// ローカルモードの場合はログインページへ
	redirect(302, '/');
};
