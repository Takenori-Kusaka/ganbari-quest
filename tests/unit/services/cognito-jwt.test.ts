// tests/unit/services/cognito-jwt.test.ts
// Cognito JWT（ID Token）検証のユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jose モジュールをモック
vi.mock('jose', () => ({
	createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
	jwtVerify: vi.fn(),
}));

// logger モック
vi.mock('$lib/server/logger', () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

import { jwtVerify } from 'jose';

const mockJwtVerify = vi.mocked(jwtVerify);

beforeEach(() => {
	process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool';
	process.env.COGNITO_CLIENT_ID = 'test-client-id';
	process.env.AWS_REGION = 'us-east-1';
});

afterEach(() => {
	process.env.COGNITO_USER_POOL_ID = undefined;
	process.env.COGNITO_CLIENT_ID = undefined;
	process.env.AWS_REGION = undefined;
	vi.clearAllMocks();
});

describe('verifyIdentityToken', () => {
	it('有効な ID Token を検証してクレームを返す', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-12345',
				email: 'parent@example.com',
				email_verified: true,
				'cognito:username': 'parent_user',
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
				token_use: 'id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose mock type
		} as any);

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('valid-token');

		expect(claims).not.toBeNull();
		expect(claims?.sub).toBe('u-12345');
		expect(claims?.email).toBe('parent@example.com');
		expect(claims?.email_verified).toBe(true);
		expect(claims?.['cognito:username']).toBe('parent_user');
	});

	it('token_use が "id" でない場合 null を返す', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-12345',
				email: 'parent@example.com',
				token_use: 'access', // id ではない
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose mock type
		} as any);

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('access-token');

		expect(claims).toBeNull();
	});

	it('署名検証に失敗した場合 null を返す', async () => {
		mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('tampered-token');

		expect(claims).toBeNull();
	});

	it('期限切れ JWT の場合 null を返す', async () => {
		mockJwtVerify.mockRejectedValue(new Error('"exp" claim timestamp check failed'));

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('expired-token');

		expect(claims).toBeNull();
	});

	it('issuer が不正な場合 null を返す', async () => {
		mockJwtVerify.mockRejectedValue(new Error('unexpected "iss" claim value'));

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('wrong-issuer-token');

		expect(claims).toBeNull();
	});

	it('audience が不正な場合 null を返す', async () => {
		mockJwtVerify.mockRejectedValue(new Error('unexpected "aud" claim value'));

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('wrong-audience-token');

		expect(claims).toBeNull();
	});

	it('JWKS フェッチ失敗の場合 null を返す', async () => {
		mockJwtVerify.mockRejectedValue(new Error('request to JWKS endpoint failed'));

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('any-token');

		expect(claims).toBeNull();
	});

	it('email_verified が false の場合もクレームを返す（ポリシーは呼び出し側で判断）', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-99999',
				email: 'unverified@example.com',
				email_verified: false,
				token_use: 'id',
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose mock type
		} as any);

		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('unverified-email-token');

		expect(claims).not.toBeNull();
		expect(claims?.email_verified).toBe(false);
	});

	it('COGNITO_USER_POOL_ID が未設定の場合エラー', async () => {
		process.env.COGNITO_USER_POOL_ID = '';

		// モジュールキャッシュをクリアして再読み込み
		vi.resetModules();
		vi.mock('jose', () => ({
			createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
			jwtVerify: vi.fn(),
		}));
		vi.mock('$lib/server/logger', () => ({
			logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
		}));

		const { verifyIdentityToken: verify } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		// getCognitoConfig() がエラーを投げるが、verifyIdentityToken 内の try-catch で null に
		const claims = await verify('any-token');
		expect(claims).toBeNull();
	});
});
