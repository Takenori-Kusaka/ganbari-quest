// /auth/logout — セッション破棄
// Cookie 削除 + Cognito ログアウト（cognito モード時）

import { redirect } from '@sveltejs/kit';
import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	INVITE_COOKIE_NAME,
	SESSION_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import { buildLogoutUrl } from '$lib/server/auth/providers/cognito-oauth';
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
		try {
			const logoutUrl = buildLogoutUrl();
			// COGNITO_DOMAIN 未設定時のフォールバック URL を検出してスキップ
			if (logoutUrl && !logoutUrl.includes('localhost')) {
				redirect(302, logoutUrl);
			}
		} catch {
			// buildLogoutUrl 失敗時は Cookie 削除済みなのでログインへ
		}
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
