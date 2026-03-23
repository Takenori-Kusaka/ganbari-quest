// src/lib/server/auth/providers/cognito-jwt.ts
// Cognito JWT (ID Token) の検証

import { logger } from '$lib/server/logger';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface CognitoClaims {
	sub: string; // ユーザーID
	email: string;
	email_verified?: boolean;
	'cognito:username'?: string;
	iss: string;
	aud: string;
}

/** Cognito User Pool の設定（環境変数から取得） */
function getCognitoConfig() {
	const userPoolId = process.env.COGNITO_USER_POOL_ID;
	const clientId = process.env.COGNITO_CLIENT_ID;
	const region = process.env.AWS_REGION ?? 'us-east-1';

	if (!userPoolId || !clientId) {
		throw new Error(
			'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be set when AUTH_MODE=cognito',
		);
	}

	return {
		userPoolId,
		clientId,
		region,
		issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
		jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
	};
}

/** JWKS（キャッシュ、jose が自動管理） */
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
	if (_jwks) return _jwks;
	const config = getCognitoConfig();
	_jwks = createRemoteJWKSet(new URL(config.jwksUri));
	return _jwks;
}

/**
 * Cognito ID Token を検証し、クレームを返す。
 * 無効な場合は null。
 */
export async function verifyIdentityToken(token: string): Promise<CognitoClaims | null> {
	try {
		const config = getCognitoConfig();
		const { payload } = await jwtVerify(token, getJWKS(), {
			issuer: config.issuer,
			audience: config.clientId,
		});

		// token_use が id であることを確認
		if (payload.token_use !== 'id') {
			logger.warn('[AUTH] JWT token_use is not "id"', {
				context: { token_use: payload.token_use },
			});
			return null;
		}

		return {
			sub: payload.sub as string,
			email: payload.email as string,
			email_verified: payload.email_verified as boolean | undefined,
			'cognito:username': payload['cognito:username'] as string | undefined,
			iss: payload.iss as string,
			aud: payload.aud as string,
		};
	} catch (e) {
		logger.warn('[AUTH] JWT verification failed', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return null;
	}
}
