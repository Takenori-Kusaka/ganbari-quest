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
	const region = process.env.AWS_REGION ?? 'us-east-1';

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

export interface CognitoMfaChallenge {
	success: false;
	error: 'MFA_REQUIRED';
	message: string;
	/** MFA チャレンジ応答に必要なセッション */
	session: string;
	/** チャレンジタイプ（SOFTWARE_TOKEN_MFA 等） */
	challengeName: string;
}

export interface CognitoAuthError {
	success: false;
	error: 'INVALID_CREDENTIALS' | 'USER_NOT_FOUND' | 'NOT_CONFIRMED' | 'UNKNOWN';
	message: string;
}

/**
 * Cognito InitiateAuth API で Email/Password 認証を実行
 * USER_PASSWORD_AUTH フローを使用（Client Secret なし前提）
 */
export async function authenticateWithCognito(
	email: string,
	password: string,
): Promise<CognitoAuthResult | CognitoMfaChallenge | CognitoAuthError> {
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
		if (response.ChallengeName && response.Session) {
			logger.info('[AUTH] MFA challenge required', {
				context: { challenge: response.ChallengeName },
			});
			return {
				success: false,
				error: 'MFA_REQUIRED',
				message: 'MFA認証コードを入力してください',
				session: response.Session,
				challengeName: response.ChallengeName,
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

/**
 * MFA チャレンジに応答する（TOTP コードを送信）
 */
export async function respondToMfaChallenge(
	session: string,
	mfaCode: string,
	challengeName: string,
): Promise<CognitoAuthResult | CognitoAuthError> {
	const config = getConfig();
	const client = new CognitoIdentityProviderClient({ region: config.region });

	try {
		const { RespondToAuthChallengeCommand } = await import(
			'@aws-sdk/client-cognito-identity-provider'
		);

		const command = new RespondToAuthChallengeCommand({
			ClientId: config.clientId,
			ChallengeName: challengeName as 'SOFTWARE_TOKEN_MFA' | 'SMS_MFA',
			Session: session,
			ChallengeResponses: {
				USERNAME: '', // Cognito が Session から解決するため空でも可
				SOFTWARE_TOKEN_MFA_CODE: mfaCode,
			},
		});

		const response = await client.send(command);
		const result = response.AuthenticationResult;

		if (!result?.IdToken || !result.AccessToken) {
			return {
				success: false,
				error: 'UNKNOWN',
				message: 'MFA認証レスポンスが不正です',
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
		logger.warn('[AUTH] MFA challenge response failed', {
			context: { errorName, error: e instanceof Error ? e.message : String(e) },
		});

		if (errorName === 'CodeMismatchException') {
			return {
				success: false,
				error: 'INVALID_CREDENTIALS',
				message: '認証コードが正しくありません',
			};
		}

		if (errorName === 'ExpiredCodeException' || errorName === 'NotAuthorizedException') {
			return {
				success: false,
				error: 'UNKNOWN',
				message: 'セッションが期限切れです。もう一度ログインしてください',
			};
		}

		return {
			success: false,
			error: 'UNKNOWN',
			message: 'MFA認証に失敗しました',
		};
	}
}

/**
 * サインアップ（ユーザー登録）
 */
export async function signUpWithCognito(
	email: string,
	password: string,
): Promise<{ success: true; userConfirmed: boolean } | CognitoAuthError> {
	const config = getConfig();
	const client = new CognitoIdentityProviderClient({ region: config.region });

	try {
		const { SignUpCommand } = await import('@aws-sdk/client-cognito-identity-provider');

		const command = new SignUpCommand({
			ClientId: config.clientId,
			Username: email,
			Password: password,
			UserAttributes: [{ Name: 'email', Value: email }],
		});

		const response = await client.send(command);

		return {
			success: true,
			userConfirmed: response.UserConfirmed ?? false,
		};
	} catch (e: unknown) {
		const errorName = (e as { name?: string })?.name ?? '';
		logger.warn('[AUTH] Cognito SignUp failed', {
			context: { errorName, error: e instanceof Error ? e.message : String(e) },
		});

		if (errorName === 'UsernameExistsException') {
			return {
				success: false,
				error: 'UNKNOWN',
				message: 'このメールアドレスは既に登録されています',
			};
		}

		if (errorName === 'InvalidPasswordException') {
			return {
				success: false,
				error: 'UNKNOWN',
				message: 'パスワードが要件を満たしていません（8文字以上、大小英字・数字を含む）',
			};
		}

		return {
			success: false,
			error: 'UNKNOWN',
			message: '登録に失敗しました。しばらくしてからお試しください',
		};
	}
}

/**
 * メール認証コード確認
 */
export async function confirmSignUp(
	email: string,
	confirmationCode: string,
): Promise<{ success: true } | CognitoAuthError> {
	const config = getConfig();
	const client = new CognitoIdentityProviderClient({ region: config.region });

	try {
		const { ConfirmSignUpCommand } = await import('@aws-sdk/client-cognito-identity-provider');

		const command = new ConfirmSignUpCommand({
			ClientId: config.clientId,
			Username: email,
			ConfirmationCode: confirmationCode,
		});

		await client.send(command);
		return { success: true };
	} catch (e: unknown) {
		const errorName = (e as { name?: string })?.name ?? '';
		logger.warn('[AUTH] Cognito ConfirmSignUp failed', {
			context: { errorName, error: e instanceof Error ? e.message : String(e) },
		});

		if (errorName === 'CodeMismatchException') {
			return {
				success: false,
				error: 'UNKNOWN',
				message: '確認コードが正しくありません',
			};
		}

		if (errorName === 'ExpiredCodeException') {
			return {
				success: false,
				error: 'UNKNOWN',
				message: '確認コードの有効期限が切れています',
			};
		}

		return {
			success: false,
			error: 'UNKNOWN',
			message: '確認に失敗しました',
		};
	}
}
