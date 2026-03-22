// /auth/callback — Cognito OAuth コールバック
// Authorization Code を受け取り、トークン交換して Cookie にセット

import {
	exchangeCodeForTokens,
	setIdentityCookie,
	verifyOAuthState,
} from '$lib/server/auth/providers/cognito-oauth';
import { logger } from '$lib/server/logger';
import { redirect } from '@sveltejs/kit';
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
		redirect(302, '/login?error=oauth_failed');
	}

	if (!code || !state) {
		redirect(302, '/login?error=missing_params');
	}

	// CSRF 検証
	if (!verifyOAuthState(state, cookies)) {
		logger.warn('[AUTH] OAuth state mismatch');
		redirect(302, '/login?error=invalid_state');
	}

	try {
		// Authorization Code → Token 交換
		const tokens = await exchangeCodeForTokens(code, cookies);

		// ID Token を Cookie にセット
		setIdentityCookie(cookies, tokens.idToken);

		// 認証成功 → 管理画面へ（resolveContext で自動的にテナント選択される）
		redirect(302, '/admin');
	} catch (e) {
		logger.error('[AUTH] OAuth callback token exchange failed', {
			error: e instanceof Error ? e.message : String(e),
		});
		redirect(302, '/login?error=token_exchange_failed');
	}
};
