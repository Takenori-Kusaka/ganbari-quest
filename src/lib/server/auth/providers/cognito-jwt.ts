// src/lib/server/auth/providers/cognito-jwt.ts
// Cognito JWT (ID Token) の検証

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { logger } from '$lib/server/logger';

export interface CognitoClaims {
	sub: string; // ユーザーID
	email: string;
	email_verified?: boolean;
	'cognito:username'?: string;
	/** #820: ユーザーが所属する Cognito group の一覧（例: ['ops']） */
	'cognito:groups'?: string[];
	/** #3025: federated IdP 経由ユーザのみ持つ (例: [{providerName: 'Google', ...}])。有無で federated 判定 */
	identities?: unknown[];
	/** #3025: 実認証時刻 (epoch 秒、JWT 標準 claim)。refresh token 経由の再発行では元のログイン時刻を保持する */
	auth_time?: number;
	/**
	 * #4266: 認証で完了した方式の一覧 (RFC 8176 Authentication Methods References)。
	 * MFA チャレンジを経たかの判定に使う。判定は `hasMfaAmr()` に集約する。
	 */
	amr?: string[];
	iss: string;
	aud: string;
}

/**
 * #4266: `amr` claim が MFA チャレンジ完了を示しているか判定する (純関数)。
 *
 * Cognito の MFA チャレンジ名は `SOFTWARE_TOKEN_MFA` / `SMS_MFA` / `EMAIL_OTP` であり、
 * ID token の `amr` にどの綴りで載るかは pool 設定・認証フローで揺れる。特定の 1 綴りに
 * 賭けると「MFA を設定したのに弾かれる」事故になるため、MFA を示す既知の綴りを
 * 大小文字無視で受理する。
 *
 * **判定できない場合は false = 拒否 (fail-closed、ADR-0024「設定が無ければ止める」)。**
 * 未設定を「たぶん大丈夫」に倒すと、防御層が黙って消える (#4276 が炙り出した失敗様式)。
 */
const MFA_AMR_VALUES = ['mfa', 'software_token_mfa', 'sms_mfa', 'email_otp', 'otp'] as const;

export function hasMfaAmr(amr: readonly string[] | undefined): boolean {
	if (!Array.isArray(amr)) return false;
	return amr.some(
		(m) => typeof m === 'string' && (MFA_AMR_VALUES as readonly string[]).includes(m.toLowerCase()),
	);
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
			identities: Array.isArray(payload.identities) ? payload.identities : undefined,
			auth_time: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
			// #4266: 非配列 (想定外の形) は undefined に落とし、hasMfaAmr() で拒否側に倒す
			amr: Array.isArray(payload.amr)
				? payload.amr.filter((m): m is string => typeof m === 'string')
				: undefined,
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
