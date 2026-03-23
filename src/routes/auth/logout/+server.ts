// /auth/logout — セッション破棄
// Cookie 削除 + /auth/login にリダイレクト
// Email/Password 直接認証のため Hosted UI ログアウトは不要

import { CONTEXT_COOKIE_NAME, IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function clearSessionCookies(cookies: import('@sveltejs/kit').Cookies) {
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });
}

export const POST: RequestHandler = async ({ cookies }) => {
	clearSessionCookies(cookies);
	redirect(302, '/auth/login');
};

// GET でもログアウト可能にする（リンクからの遷移用）
export const GET: RequestHandler = async ({ cookies }) => {
	clearSessionCookies(cookies);
	redirect(302, '/auth/login');
};
