// src/lib/server/auth/providers/cognito-direct-auth.ts
// Cognito InitiateAuth API による直接 Email/Password 認証
// Hosted UI を使わず、カスタムログインフォームから直接認証する

import { logger } from '$lib/server/logger';
import {
	CognitoIdentityProviderClient,
	InitiateAuthCommand,
	type InitiateAuthCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';

interface CognitoDirectAuthConfig {
	clientId: string;
	region: string;
}

function getConfig(): CognitoDirectAuthConfig {
	const clientId = process.env.COGNITO_CLIENT_ID;
	const region = process.env.AWS_REGION ?? 'ap-northeast-1';

	if (!clientId) {
		throw new Error('COGNITO_CLIENT_ID must be set when AUTH_MODE=cognito');
	}

	return { clientId, region };
}

export interface CognitoAuthResult {
	success: true;
	idToken: string;
	accessToken: string;
	refreshToken?: string;
}

export interface CognitoAuthError {
	success: false;
	error: 'INVALID_CREDENTIALS' | 'USER_NOT_FOUND' | 'NOT_CONFIRMED' | 'MFA_REQUIRED' | 'UNKNOWN';
	message: string;
}

/**
 * Cognito InitiateAuth API で Email/Password 認証を実行
 * USER_PASSWORD_AUTH フローを使用（Client Secret なし前提）
 */
export async function authenticateWithCognito(
	email: string,
	password: string,
): Promise<CognitoAuthResult | CognitoAuthError> {
	const config = getConfig();

	const client = new CognitoIdentityProviderClient({ region: config.region });

	try {
		const command = new InitiateAuthCommand({
			AuthFlow: 'USER_PASSWORD_AUTH',
			ClientId: config.clientId,
			AuthParameters: {
				USERNAME: email,
				PASSWORD: password,
			},
		});

		const response: InitiateAuthCommandOutput = await client.send(command);

		// MFA チャレンジが必要な場合
		if (response.ChallengeName) {
			logger.info('[AUTH] MFA challenge required', {
				context: { challenge: response.ChallengeName },
			});
			return {
				success: false,
				error: 'MFA_REQUIRED',
				message: 'MFA認証が必要です（未実装）',
			};
		}

		const result = response.AuthenticationResult;
		if (!result?.IdToken || !result.AccessToken) {
			return {
				success: false,
				error: 'UNKNOWN',
				message: '認証レスポンスが不正です',
			};
		}

		return {
			success: true,
			idToken: result.IdToken,
			accessToken: result.AccessToken,
			refreshToken: result.RefreshToken,
		};
	} catch (e: unknown) {
		const errorName = (e as { name?: string })?.name ?? '';
		const errorMessage = e instanceof Error ? e.message : String(e);

		logger.warn('[AUTH] Cognito InitiateAuth failed', {
			context: { errorName, error: errorMessage },
		});

		if (errorName === 'NotAuthorizedException') {
			return {
				success: false,
				error: 'INVALID_CREDENTIALS',
				message: 'メールアドレスまたはパスワードが正しくありません',
			};
		}

		if (errorName === 'UserNotFoundException') {
			return {
				success: false,
				error: 'USER_NOT_FOUND',
				message: 'メールアドレスまたはパスワードが正しくありません',
			};
		}

		if (errorName === 'UserNotConfirmedException') {
			return {
				success: false,
				error: 'NOT_CONFIRMED',
				message: 'メールアドレスの確認が完了していません',
			};
		}

		return {
			success: false,
			error: 'UNKNOWN',
			message: 'ログインに失敗しました。しばらくしてからお試しください',
		};
	}
}
