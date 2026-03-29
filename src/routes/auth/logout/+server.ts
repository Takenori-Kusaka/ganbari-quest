// /auth/logout — セッション破棄
// Cookie 削除 + Cognito ログアウト（cognito モード時）

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

function clearSessionCookies(cookies: import('@sveltejs/kit').Cookies) {
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	cookies.delete(INVITE_COOKIE_NAME, { path: '/' }); // #0203: 残留防止
}

function handleLogout(cookies: import('@sveltejs/kit').Cookies): never {
	clearSessionCookies(cookies);

	// Cognito 本番モードのみ Hosted UI ログアウトにリダイレクト（dev モードは除外）
	if (getAuthMode() === 'cognito' && !isCognitoDevMode()) {
		redirect(302, buildLogoutUrl());
	}

	redirect(302, '/auth/login');
}

export const POST: RequestHandler = async ({ cookies }) => {
	handleLogout(cookies);
};

// GET でもログアウト可能にする（リンクからの遷移用）
export const GET: RequestHandler = async ({ cookies }) => {
	handleLogout(cookies);
};
