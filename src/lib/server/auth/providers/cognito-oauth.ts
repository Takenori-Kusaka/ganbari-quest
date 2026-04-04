// src/lib/server/auth/providers/cognito-oauth.ts
// Cognito OAuth フローヘルパー（Authorization Code Grant）

import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';

/** Cognito OAuth 設定（環境変数から取得） */
export interface CognitoOAuthConfig {
	userPoolId: string;
	clientId: string;
	clientSecret: string;
	region: string;
	/** Cognito Hosted UI ドメイン（例: ganbari-quest.auth.us-east-1.amazoncognito.com） */
	domain: string;
	/** コールバック URL（例: https://ganbari-quest.com/auth/callback） */
	callbackUrl: string;
}

const STATE_COOKIE = 'oauth_state';
const NONCE_COOKIE = 'oauth_nonce';

export function getCognitoOAuthConfig(): CognitoOAuthConfig {
	const userPoolId = process.env.COGNITO_USER_POOL_ID;
	const clientId = process.env.COGNITO_CLIENT_ID;
	const clientSecret = process.env.COGNITO_CLIENT_SECRET ?? '';
	const region = process.env.AWS_REGION ?? 'us-east-1';

	if (!userPoolId || !clientId) {
		throw new Error(
			'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be set when AUTH_MODE=cognito',
		);
	}

	const domain = process.env.COGNITO_DOMAIN ?? `ganbari-quest.auth.${region}.amazoncognito.com`;
	const callbackUrl = process.env.COGNITO_CALLBACK_URL ?? 'http://localhost:5173/auth/callback';

	return { userPoolId, clientId, clientSecret, region, domain, callbackUrl };
}

/** Cognito Hosted UI の認可エンドポイント URL を生成 */
export function buildAuthorizeUrl(cookies: Cookies, identityProvider?: string): string {
	const config = getCognitoOAuthConfig();
	const state = randomBytes(32).toString('hex');
	const nonce = randomBytes(16).toString('hex');

	// CSRF 防止用 state を Cookie に保存
	const cookieOpts = {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: COOKIE_SECURE,
		maxAge: 600, // 10分
	};
	cookies.set(STATE_COOKIE, state, cookieOpts);
	cookies.set(NONCE_COOKIE, nonce, cookieOpts);

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: config.clientId,
		redirect_uri: config.callbackUrl,
		scope: 'openid email',
		state,
		nonce,
	});

	// 特定の IdP に直接リダイレクト（Hosted UI スキップ）
	if (identityProvider) {
		params.set('identity_provider', identityProvider);
	}

	return `https://${config.domain}/oauth2/authorize?${params.toString()}`;
}

/** Authorization Code → Token 交換 */
export async function exchangeCodeForTokens(
	code: string,
	cookies: Cookies,
): Promise<{ idToken: string; accessToken: string; refreshToken?: string }> {
	const config = getCognitoOAuthConfig();

	// state 検証
	const savedState = cookies.get(STATE_COOKIE);
	if (!savedState) {
		throw new Error('OAuth state cookie not found');
	}

	// state Cookie をクリア
	cookies.delete(STATE_COOKIE, { path: '/' });
	cookies.delete(NONCE_COOKIE, { path: '/' });

	// Token エンドポイントへリクエスト
	const tokenUrl = `https://${config.domain}/oauth2/token`;

	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: config.callbackUrl,
		client_id: config.clientId,
	});

	const headers: Record<string, string> = {
		'Content-Type': 'application/x-www-form-urlencoded',
	};

	// Client Secret がある場合は Basic 認証
	if (config.clientSecret) {
		const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
		headers.Authorization = `Basic ${credentials}`;
	}

	const response = await fetch(tokenUrl, {
		method: 'POST',
		headers,
		body: body.toString(),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		logger.error('[AUTH] Token exchange failed', {
			error: errorBody,
			context: { status: response.status },
		});
		throw new Error(`Token exchange failed: ${response.status}`);
	}

	const data = (await response.json()) as {
		id_token: string;
		access_token: string;
		refresh_token?: string;
	};

	return {
		idToken: data.id_token,
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
	};
}

/** state パラメータを検証する */
export function verifyOAuthState(state: string, cookies: Cookies): boolean {
	const savedState = cookies.get(STATE_COOKIE);
	return savedState === state;
}

/** ID Token を Cookie に設定する */
export function setIdentityCookie(cookies: Cookies, idToken: string): void {
	cookies.set(IDENTITY_COOKIE_NAME, idToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: COOKIE_SECURE,
		maxAge: 60 * 60, // 1時間（Cognito ID Token の有効期限に合わせる）
	});
}

/** Cognito ログアウト URL を生成する */
export function buildLogoutUrl(): string {
	const config = getCognitoOAuthConfig();
	const logoutRedirect = process.env.COGNITO_LOGOUT_URL ?? 'http://localhost:5173/login';

	const params = new URLSearchParams({
		client_id: config.clientId,
		logout_uri: logoutRedirect,
	});

	return `https://${config.domain}/logout?${params.toString()}`;
}
