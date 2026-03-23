// /auth/logout — セッション破棄
// Cookie 削除 + リダイレクト（devモード: /auth/login, 本番: Cognito Hosted UI）

import { CONTEXT_COOKIE_NAME, IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { isCognitoDevMode } from '$lib/server/auth/factory';
import { buildLogoutUrl } from '$lib/server/auth/providers/cognito-oauth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function clearSessionCookies(cookies: import('@sveltejs/kit').Cookies) {
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });
}

function getLogoutRedirect(): string {
	if (isCognitoDevMode()) {
		return '/auth/login';
	}
	return buildLogoutUrl();
}

export const POST: RequestHandler = async ({ cookies }) => {
	clearSessionCookies(cookies);
	redirect(302, getLogoutRedirect());
};

// GET でもログアウト可能にする（リンクからの遷移用）
export const GET: RequestHandler = async ({ cookies }) => {
	clearSessionCookies(cookies);
	redirect(302, getLogoutRedirect());
};
