// /auth/logout — Cognito セッション破棄
// Cookie 削除 + Cognito Hosted UI ログアウトへリダイレクト

import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { buildLogoutUrl } from '$lib/server/auth/providers/cognito-oauth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	// セッション Cookie を削除
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });

	// Cognito Hosted UI のログアウトへリダイレクト
	const logoutUrl = buildLogoutUrl();
	redirect(302, logoutUrl);
};

// GET でもログアウト可能にする（リンクからの遷移用）
export const GET: RequestHandler = async ({ cookies }) => {
	cookies.delete(IDENTITY_COOKIE_NAME, { path: '/' });
	cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });

	const logoutUrl = buildLogoutUrl();
	redirect(302, logoutUrl);
};
