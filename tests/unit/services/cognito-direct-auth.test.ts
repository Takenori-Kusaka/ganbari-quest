// tests/unit/services/cognito-direct-auth.test.ts
// Cognito Direct Auth (SignUp, ConfirmSignUp, Authenticate, MFA) のユニットテスト
// AWS SDK をモックして各関数のエラーハンドリングを検証する

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK のモック
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
	class MockClient {
		send = mockSend;
	}
	class MockInitiateAuthCommand {
		constructor(params: Record<string, unknown>) {
			Object.assign(this, params, { _type: 'InitiateAuth' });
		}
	}
	class MockSignUpCommand {
		constructor(params: Record<string, unknown>) {
			Object.assign(this, params, { _type: 'SignUp' });
		}
	}
	class MockConfirmSignUpCommand {
		constructor(params: Record<string, unknown>) {
			Object.assign(this, params, { _type: 'ConfirmSignUp' });
		}
	}
	class MockRespondToAuthChallengeCommand {
		constructor(params: Record<string, unknown>) {
			Object.assign(this, params, { _type: 'RespondToAuthChallenge' });
		}
	}
	return {
		CognitoIdentityProviderClient: MockClient,
		InitiateAuthCommand: MockInitiateAuthCommand,
		SignUpCommand: MockSignUpCommand,
		ConfirmSignUpCommand: MockConfirmSignUpCommand,
		RespondToAuthChallengeCommand: MockRespondToAuthChallengeCommand,
	};
});

beforeEach(() => {
	process.env.COGNITO_CLIENT_ID = 'test-client-id';
	process.env.AWS_REGION = 'us-east-1';
	mockSend.mockReset();
});

afterEach(() => {
	process.env.COGNITO_CLIENT_ID = undefined;
	process.env.AWS_REGION = undefined;
	vi.restoreAllMocks();
});

// ============================================================
// signUpWithCognito
// ============================================================
describe('signUpWithCognito', () => {
	it('正常にサインアップし userConfirmed=false を返す', async () => {
		mockSend.mockResolvedValue({ UserConfirmed: false, UserSub: 'user-123' });

		const { signUpWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await signUpWithCognito('test@example.com', 'Password1');

		expect(result).toEqual({ success: true, userConfirmed: false });
	});

	it('auto-verify 時に userConfirmed=true を返す', async () => {
		mockSend.mockResolvedValue({ UserConfirmed: true, UserSub: 'user-123' });

		const { signUpWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await signUpWithCognito('test@example.com', 'Password1');

		expect(result).toEqual({ success: true, userConfirmed: true });
	});

	it('UsernameExistsException で適切なエラーメッセージ', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('exists'), { name: 'UsernameExistsException' }),
		);

		const { signUpWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await signUpWithCognito('test@example.com', 'Password1');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.message).toContain('既に登録されています');
		}
	});

	it('InvalidPasswordException で適切なエラーメッセージ', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('bad password'), { name: 'InvalidPasswordException' }),
		);

		const { signUpWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await signUpWithCognito('test@example.com', 'weak');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.message).toContain('パスワードが要件を満たしていません');
		}
	});

	it('不明なエラーで汎用メッセージ', async () => {
		mockSend.mockRejectedValue(new Error('network error'));

		const { signUpWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await signUpWithCognito('test@example.com', 'Password1');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.message).toContain('登録に失敗しました');
		}
	});

	it('COGNITO_CLIENT_ID 未設定でエラー', async () => {
		process.env.COGNITO_CLIENT_ID = '';

		const { signUpWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		await expect(signUpWithCognito('test@example.com', 'Password1')).rejects.toThrow(
			'COGNITO_CLIENT_ID',
		);
	});
});

// ============================================================
// confirmSignUp
// ============================================================
describe('confirmSignUp', () => {
	it('正常に確認コードを検証する', async () => {
		mockSend.mockResolvedValue({});

		const { confirmSignUp } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await confirmSignUp('test@example.com', '123456');

		expect(result).toEqual({ success: true });
	});

	it('CodeMismatchException で適切なエラーメッセージ', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('mismatch'), { name: 'CodeMismatchException' }),
		);

		const { confirmSignUp } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await confirmSignUp('test@example.com', '000000');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.message).toContain('確認コードが正しくありません');
		}
	});

	it('ExpiredCodeException で適切なエラーメッセージ', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('expired'), { name: 'ExpiredCodeException' }),
		);

		const { confirmSignUp } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await confirmSignUp('test@example.com', '123456');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.message).toContain('有効期限が切れています');
		}
	});
});

// ============================================================
// authenticateWithCognito
// ============================================================
describe('authenticateWithCognito', () => {
	it('正常にログインしトークンを返す', async () => {
		mockSend.mockResolvedValue({
			AuthenticationResult: {
				IdToken: 'id-token-abc',
				AccessToken: 'access-token-abc',
				RefreshToken: 'refresh-token-abc',
			},
		});

		const { authenticateWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await authenticateWithCognito('test@example.com', 'Password1');

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.idToken).toBe('id-token-abc');
			expect(result.accessToken).toBe('access-token-abc');
		}
	});

	it('MFA チャレンジ時にセッション情報を返す', async () => {
		mockSend.mockResolvedValue({
			ChallengeName: 'SOFTWARE_TOKEN_MFA',
			Session: 'mfa-session-xyz',
		});

		const { authenticateWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await authenticateWithCognito('test@example.com', 'Password1');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('MFA_REQUIRED');
			if (result.error === 'MFA_REQUIRED') {
				expect(result.session).toBe('mfa-session-xyz');
				expect(result.challengeName).toBe('SOFTWARE_TOKEN_MFA');
			}
		}
	});

	it('NotAuthorizedException でエラー', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('bad creds'), { name: 'NotAuthorizedException' }),
		);

		const { authenticateWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await authenticateWithCognito('test@example.com', 'wrong');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('INVALID_CREDENTIALS');
		}
	});

	it('UserNotConfirmedException でエラー', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('not confirmed'), { name: 'UserNotConfirmedException' }),
		);

		const { authenticateWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await authenticateWithCognito('test@example.com', 'Password1');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('NOT_CONFIRMED');
		}
	});

	it('AuthenticationResult が不完全な場合にエラー', async () => {
		mockSend.mockResolvedValue({
			AuthenticationResult: { IdToken: null, AccessToken: null },
		});

		const { authenticateWithCognito } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await authenticateWithCognito('test@example.com', 'Password1');

		expect(result.success).toBe(false);
	});
});

// ============================================================
// respondToMfaChallenge
// ============================================================
describe('respondToMfaChallenge', () => {
	it('正常にMFAチャレンジに応答しトークンを返す', async () => {
		mockSend.mockResolvedValue({
			AuthenticationResult: {
				IdToken: 'mfa-id-token',
				AccessToken: 'mfa-access-token',
			},
		});

		const { respondToMfaChallenge } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await respondToMfaChallenge('session-abc', '123456', 'SOFTWARE_TOKEN_MFA');

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.idToken).toBe('mfa-id-token');
		}
	});

	it('CodeMismatchException で適切なエラー', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('mismatch'), { name: 'CodeMismatchException' }),
		);

		const { respondToMfaChallenge } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await respondToMfaChallenge('session-abc', '000000', 'SOFTWARE_TOKEN_MFA');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('INVALID_CREDENTIALS');
		}
	});

	it('ExpiredCodeException でセッション切れエラー', async () => {
		mockSend.mockRejectedValue(
			Object.assign(new Error('expired'), { name: 'ExpiredCodeException' }),
		);

		const { respondToMfaChallenge } = await import(
			'../../../src/lib/server/auth/providers/cognito-direct-auth'
		);
		const result = await respondToMfaChallenge('old-session', '123456', 'SOFTWARE_TOKEN_MFA');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.message).toContain('期限切れ');
		}
	});
});
