// src/lib/server/auth/providers/cognito-dev-jwt.ts
// ローカル開発用ダミー JWT 生成・検証（COGNITO_DEV_MODE=true 時に使用）
// 実際の Cognito JWKS の代わりにプロセスローカルの RSA キーペアを使う

import { SignJWT, exportJWK, generateKeyPair, jwtVerify } from 'jose';
import type { CognitoClaims } from './cognito-jwt';

const DEV_ISSUER = 'https://cognito-idp.local.amazonaws.com/local_dev_pool';
const DEV_AUDIENCE = 'dev_client_id';

/** プロセスローカルのキーペア（再起動で無効化される） */
let _keyPair: { privateKey: CryptoKey; publicKey: CryptoKey } | null = null;

async function getKeyPair() {
	if (_keyPair) return _keyPair;
	_keyPair = await generateKeyPair('RS256');
	return _keyPair;
}

export interface DevUserProfile {
	userId: string;
	email: string;
	username?: string;
}

/** ダミー Cognito ID Token を生成 */
export async function signDevIdentityToken(user: DevUserProfile): Promise<string> {
	const { privateKey } = await getKeyPair();
	return new SignJWT({
		sub: user.userId,
		email: user.email,
		email_verified: true,
		'cognito:username': user.username ?? user.email,
		token_use: 'id',
	})
		.setProtectedHeader({ alg: 'RS256', kid: 'dev-key-1' })
		.setIssuer(DEV_ISSUER)
		.setAudience(DEV_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(privateKey);
}

/** ダミー JWT をローカルキーで検証 */
export async function verifyDevIdentityToken(token: string): Promise<CognitoClaims | null> {
	try {
		const { publicKey } = await getKeyPair();
		const { payload } = await jwtVerify(token, publicKey, {
			issuer: DEV_ISSUER,
			audience: DEV_AUDIENCE,
		});

		if (payload.token_use !== 'id') return null;

		return {
			sub: payload.sub as string,
			email: payload.email as string,
			email_verified: payload.email_verified as boolean | undefined,
			'cognito:username': payload['cognito:username'] as string | undefined,
			iss: payload.iss as string,
			aud: payload.aud as string,
		};
	} catch {
		return null;
	}
}

/** 開発用 JWKS エンドポイント用の公開鍵を取得 */
export async function getDevJWKS() {
	const { publicKey } = await getKeyPair();
	const jwk = await exportJWK(publicKey);
	return { keys: [{ ...jwk, kid: 'dev-key-1', alg: 'RS256', use: 'sig' }] };
}
