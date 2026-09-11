// /auth/logout — セッション破棄
// Cookie 削除 + Cognito ログアウト（cognito モード時）

import { redirect } from '@sveltejs/kit';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	buildLogoutUrl,
	revokeCognitoRefreshToken,
} from '$lib/server/auth/providers/cognito-oauth';
import { clearAuthSessionCookies } from '$lib/server/auth/session-cookies';
import type { RequestHandler } from './$types';

async function handleLogout(cookies: import('@sveltejs/kit').Cookies): Promise<never> {
	// Cognito 本番モード: Refresh Token を失効させてから Cookie 削除 (#1365)
	if (getAuthMode() === 'cognito' && !isCognitoDevMode()) {
		await revokeCognitoRefreshToken(cookies);
	}

	// 親ゲート PIN session を含む全セッション cookie を破棄 (#4700、一覧は session-cookies.ts SSOT)
	clearAuthSessionCookies(cookies);

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

export const POST: RequestHandler = ({ cookies }) => handleLogout(cookies);

// GET でもログアウト可能にする（リンクからの遷移用）
export const GET: RequestHandler = ({ cookies }) => handleLogout(cookies);
