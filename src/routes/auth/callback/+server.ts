// /auth/callback — Cognito OAuth コールバック
// Authorization Code を受け取り、トークン交換して Cookie にセット

import { redirect } from '@sveltejs/kit';
import {
	exchangeCodeForTokens,
	setIdentityCookie,
	setRefreshCookie,
	verifyOAuthState,
} from '$lib/server/auth/providers/cognito-oauth';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	// Cognito がエラーを返した場合
	if (error) {
		logger.warn('[AUTH] OAuth callback error', {
			context: { error, description: url.searchParams.get('error_description') },
		});
		redirect(302, '/auth/login?error=oauth_failed');
	}

	if (!code || !state) {
		redirect(302, '/auth/login?error=missing_params');
	}

	// CSRF 検証
	if (!verifyOAuthState(state, cookies)) {
		logger.warn('[AUTH] OAuth state mismatch');
		redirect(302, '/auth/login?error=invalid_state');
	}

	// #3025: redirect() は throw するため try 内で成功 redirect を投げると catch に捕まり
	// error redirect に化ける (従来コードの潜在バグ)。成功遷移先は try の外で確定させる。
	let successPath = '/admin';
	try {
		// Authorization Code → Token 交換
		const tokens = await exchangeCodeForTokens(code, cookies);

		// ID Token を Cookie にセット
		setIdentityCookie(cookies, tokens.idToken);

		// Refresh Token を保存してセッションを30日に延長 (#1365)
		if (tokens.refreshToken) {
			setRefreshCookie(cookies, tokens.refreshToken);
		}

		// #3025: 「Google で本人確認」(PIN reset 等) から来た場合は oauth_next cookie の
		// 内部 path (先頭 1 個の "/" のみ許可 = open redirect 防止) へ戻す
		const next = cookies.get('oauth_next');
		if (next) {
			cookies.delete('oauth_next', { path: '/' });
			if (/^\/(?!\/)/.test(next)) {
				successPath = next;
			}
		}
	} catch (e) {
		logger.error('[AUTH] OAuth callback token exchange failed', {
			error: e instanceof Error ? e.message : String(e),
		});
		redirect(302, '/auth/login?error=token_exchange_failed');
	}

	// 認証成功 → ご家族の見守り画面 or oauth_next（resolveContext で自動的にテナント選択される）
	redirect(302, successPath);
};
