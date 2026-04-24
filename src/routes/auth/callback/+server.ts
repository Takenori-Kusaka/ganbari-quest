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

	try {
		// Authorization Code → Token 交換
		const tokens = await exchangeCodeForTokens(code, cookies);

		// ID Token を Cookie にセット
		setIdentityCookie(cookies, tokens.idToken);

		// Refresh Token を保存してセッションを30日に延長 (#1365)
		if (tokens.refreshToken) {
			setRefreshCookie(cookies, tokens.refreshToken);
		}

		// 認証成功 → 管理画面へ（resolveContext で自動的にテナント選択される）
		redirect(302, '/admin');
	} catch (e) {
		logger.error('[AUTH] OAuth callback token exchange failed', {
			error: e instanceof Error ? e.message : String(e),
		});
		redirect(302, '/auth/login?error=token_exchange_failed');
	}
};
