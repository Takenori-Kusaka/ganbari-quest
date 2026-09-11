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

describe('#4643 email_verified を boolean に正規化する', () => {
	it('文字列 "false" を false として扱う (fail-closed 判定をすり抜けさせない)', async () => {
		const { normalizeEmailVerified } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(normalizeEmailVerified('false')).toBe(false);
	});

	it('文字列 "true" を true として扱う (federated IdP は文字列で載せることがある)', async () => {
		const { normalizeEmailVerified } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(normalizeEmailVerified('true')).toBe(true);
	});

	it('boolean はそのまま通す', async () => {
		const { normalizeEmailVerified } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(normalizeEmailVerified(true)).toBe(true);
		expect(normalizeEmailVerified(false)).toBe(false);
	});

	it('判定できない形は undefined (claim を持たない provider との後方互換)', async () => {
		const { normalizeEmailVerified } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(normalizeEmailVerified(undefined)).toBeUndefined();
		expect(normalizeEmailVerified(null)).toBeUndefined();
		expect(normalizeEmailVerified(1)).toBeUndefined();
		expect(normalizeEmailVerified('yes')).toBeUndefined();
	});

	it('verifyIdentityToken が文字列 claim を正規化して載せる', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-google',
				email: 'google@example.com',
				email_verified: 'false',
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
				token_use: 'id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose の戻り値型を最小 stub で満たす
		} as any);
		const { verifyIdentityToken } = await import('$lib/server/auth/providers/cognito-jwt');
		const claims = await verifyIdentityToken('dummy');
		expect(claims?.email_verified).toBe(false);
	});
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

	it('#820: cognito:groups claim を配列として抽出する', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-ops-1',
				email: 'ops@example.com',
				token_use: 'id',
				'cognito:groups': ['ops', 'admin'],
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose mock type
		} as any);

		vi.resetModules();
		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('ops-token');

		expect(claims?.['cognito:groups']).toEqual(['ops', 'admin']);
	});

	it('#820: cognito:groups が未定義の場合は undefined を返す', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-plain-1',
				email: 'plain@example.com',
				token_use: 'id',
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose mock type
		} as any);

		vi.resetModules();
		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('plain-token');

		expect(claims?.['cognito:groups']).toBeUndefined();
	});

	it('#820: cognito:groups に非文字列が混在していたら除外する', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-dirty-1',
				email: 'dirty@example.com',
				token_use: 'id',
				'cognito:groups': ['ops', 42, null, 'admin'],
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose mock type
		} as any);

		vi.resetModules();
		const { verifyIdentityToken } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		const claims = await verifyIdentityToken('dirty-token');

		expect(claims?.['cognito:groups']).toEqual(['ops', 'admin']);
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

		// モジュールキャッシュをクリアして再読み込み（トップレベルの vi.mock が有効）
		vi.resetModules();

		const { verifyIdentityToken: verify } = await import(
			'../../../src/lib/server/auth/providers/cognito-jwt'
		);
		// getCognitoConfig() がエラーを投げるが、verifyIdentityToken 内の try-catch で null に
		const claims = await verify('any-token');
		expect(claims).toBeNull();
	});
});

// ---------- #4266: MFA 判定 (amr claim) ----------
// PO 決裁 (2026-08-05) で admin IP allowlist を廃止したため、/ops の主防御は
// 「ops group + MFA」になった。MFA を経たかは ID token の `amr` (Authentication Methods
// References, RFC 8176) claim で判定する。Cognito は認証で完了したチャレンジを amr に載せる。
// 値の綴りは実装依存 (mfa / software_token_mfa / sms_mfa) のため、いずれか 1 つで真とする。
// 判定できない (claim 欠落 / 非配列) 場合は false = 拒否 (fail-closed)。
describe('#4266 hasMfaAmr — amr claim から MFA 済を判定する', () => {
	it('amr に "mfa" を含めば true', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(['pwd', 'mfa'])).toBe(true);
	});

	it('amr に "software_token_mfa" (TOTP) を含めば true', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(['pwd', 'software_token_mfa'])).toBe(true);
	});

	it('amr に "sms_mfa" を含めば true', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(['sms_mfa'])).toBe(true);
	});

	// 本アプリの email OTP は Cognito MFA ではなくアプリ層の機構 (auth-stack.ts)。
	// otp 系を MFA 済と誤認すると「二要素を経ていないセッション」が /ops を通る。
	it('amr が "otp" のみは false (単要素の可能性がある綴りは受理しない)', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(['otp'])).toBe(false);
	});

	it('amr が "email_otp" のみは false', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(['pwd', 'email_otp'])).toBe(false);
	});

	it('大文字表記 (SOFTWARE_TOKEN_MFA) でも true', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(['PWD', 'SOFTWARE_TOKEN_MFA'])).toBe(true);
	});

	it('password のみは false', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(['pwd'])).toBe(false);
	});

	it('claim 欠落 (undefined) は false (fail-closed)', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr(undefined)).toBe(false);
	});

	it('空配列は false', async () => {
		const { hasMfaAmr } = await import('$lib/server/auth/providers/cognito-jwt');
		expect(hasMfaAmr([])).toBe(false);
	});
});

describe('#4266 verifyIdentityToken が amr claim を伝搬する', () => {
	it('amr を claims に載せる', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-ops',
				email: 'ops@example.com',
				amr: ['pwd', 'mfa'],
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
				token_use: 'id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose の戻り値型を最小 stub で満たす
		} as any);
		const { verifyIdentityToken } = await import('$lib/server/auth/providers/cognito-jwt');
		const claims = await verifyIdentityToken('dummy');
		expect(claims?.amr).toEqual(['pwd', 'mfa']);
	});

	it('amr が非配列なら undefined (fail-closed 側に倒す)', async () => {
		mockJwtVerify.mockResolvedValue({
			payload: {
				sub: 'u-ops',
				email: 'ops@example.com',
				amr: 'mfa',
				iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool',
				aud: 'test-client-id',
				token_use: 'id',
			},
			protectedHeader: { alg: 'RS256' },
			// biome-ignore lint/suspicious/noExplicitAny: jose の戻り値型を最小 stub で満たす
		} as any);
		const { verifyIdentityToken } = await import('$lib/server/auth/providers/cognito-jwt');
		const claims = await verifyIdentityToken('dummy');
		expect(claims?.amr).toBeUndefined();
	});
});
