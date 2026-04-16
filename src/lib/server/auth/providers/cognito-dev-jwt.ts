// src/lib/server/auth/providers/cognito-dev-jwt.ts
// ローカル開発用ダミー JWT 生成・検証（COGNITO_DEV_MODE=true 時に使用）
// HS256 + 固定シークレットを使い、Lambda インスタンス間でも JWT を共有可能にする

import { jwtVerify, SignJWT } from 'jose';
import type { CognitoClaims } from './cognito-jwt';

const DEV_ISSUER = 'https://cognito-idp.local.amazonaws.com/local_dev_pool';
const DEV_AUDIENCE = 'dev_client_id';

/**
 * 開発専用の固定シークレット（HS256）。
 * プロセスをまたいでも同じ鍵で署名・検証できる。
 * 本番では COGNITO_DEV_MODE=true にしないため、セキュリティ上の問題はない。
 */
const DEV_SECRET = new TextEncoder().encode(
	'ganbari-quest-dev-jwt-secret-do-not-use-in-production',
);

export interface DevUserProfile {
	userId: string;
	email: string;
	username?: string;
	/** #820: ダミー JWT の `cognito:groups` claim に載せる group 一覧 */
	groups?: string[];
}

/** ダミー Cognito ID Token を生成 */
export async function signDevIdentityToken(user: DevUserProfile): Promise<string> {
	const payload: Record<string, unknown> = {
		sub: user.userId,
		email: user.email,
		email_verified: true,
		'cognito:username': user.username ?? user.email,
		token_use: 'id',
	};
	if (user.groups && user.groups.length > 0) {
		payload['cognito:groups'] = user.groups;
	}
	return new SignJWT(payload)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuer(DEV_ISSUER)
		.setAudience(DEV_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(DEV_SECRET);
}

/** ダミー JWT をローカルキーで検証 */
export async function verifyDevIdentityToken(token: string): Promise<CognitoClaims | null> {
	try {
		const { payload } = await jwtVerify(token, DEV_SECRET, {
			issuer: DEV_ISSUER,
			audience: DEV_AUDIENCE,
		});

		if (payload.token_use !== 'id') return null;

		const rawGroups = payload['cognito:groups'];
		const groups = Array.isArray(rawGroups)
			? rawGroups.filter((g): g is string => typeof g === 'string')
			: undefined;

		return {
			sub: payload.sub as string,
			email: payload.email as string,
			email_verified: payload.email_verified as boolean | undefined,
			'cognito:username': payload['cognito:username'] as string | undefined,
			'cognito:groups': groups,
			iss: payload.iss as string,
			aud: payload.aud as string,
		};
	} catch {
		return null;
	}
}
