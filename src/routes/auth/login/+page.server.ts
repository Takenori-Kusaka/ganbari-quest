// /auth/login — Email/Password ログイン
// AUTH_MODE=cognito 時に使用
// - devモード: ダミーユーザーで認証
// - 本番: Cognito InitiateAuth API で直接認証（Hosted UI は使わない）
// - Email OTP: Cognito認証成功後、アプリ層でメールOTPを追加検証

import { IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import { authenticateDevUser } from '$lib/server/auth/providers/cognito-dev';
import { signDevIdentityToken } from '$lib/server/auth/providers/cognito-dev-jwt';
import {
	authenticateWithCognito,
	respondToMfaChallenge,
} from '$lib/server/auth/providers/cognito-direct-auth';
import { setIdentityCookie } from '$lib/server/auth/providers/cognito-oauth';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import {
	checkAccountLockout,
	recordLoginFailure,
	resetLoginFailures,
} from '$lib/server/security/account-lockout';
import {
	getMaskedEmail,
	isEmailOtpRequired,
	sendEmailOtp,
	verifyEmailOtp,
} from '$lib/server/services/email-otp-service';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const PENDING_TOKEN_COOKIE = '__pending_token';

export const load: PageServerLoad = async ({ locals }) => {
	const _tenantId = locals.context?.tenantId;
	const authMode = getAuthMode();

	// local モードではログイン不要 → /admin へ
	if (authMode === 'local') {
		redirect(302, '/admin');
	}

	// 既にログイン済み → /admin へ
	if (locals.identity) {
		const target = locals.context?.role === 'child' ? '/switch' : '/admin';
		redirect(302, target);
	}

	return {
		devMode: isCognitoDevMode(),
	};
};

export const actions: Actions = {
	login: async ({ request, cookies, locals }) => {
		const _tenantId = locals.context?.tenantId;
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (!email || !password) {
			return fail(400, { error: 'メールアドレスとパスワードを入力してください', email });
		}

		const devMode = isCognitoDevMode();

		if (devMode) {
			return handleDevLogin(email, password, cookies);
		}

		return handleCognitoLogin(email, password, cookies);
	},

	mfa: async ({ request, cookies, locals }) => {
		const _tenantId = locals.context?.tenantId;
		const formData = await request.formData();
		const session = formData.get('session') as string;
		const mfaCode = formData.get('mfaCode') as string;
		const challengeName = formData.get('challengeName') as string;
		const email = formData.get('email') as string;

		if (!session || !mfaCode || !challengeName) {
			return fail(400, { error: 'MFA認証コードを入力してください', email, mfaStep: true });
		}

		const result = await respondToMfaChallenge(session, mfaCode, challengeName);

		if (!result.success) {
			return fail(401, {
				error: result.message,
				email,
				mfaStep: true,
				session,
				challengeName,
			});
		}

		// MFA成功後、Email OTPが必要か判定
		return finishAuthOrStartOtp(email, result.idToken, cookies);
	},

	verifyOtp: async ({ request, cookies }) => {
		const formData = await request.formData();
		const otpSessionKey = formData.get('otpSessionKey') as string;
		const otpCode = formData.get('otpCode') as string;
		const email = formData.get('email') as string;

		if (!otpSessionKey || !otpCode) {
			return fail(400, {
				error: '確認コードを入力してください',
				email,
				otpStep: true,
				otpSessionKey,
				maskedEmail: email ? getMaskedEmail(email) : '',
			});
		}

		const result = verifyEmailOtp(otpSessionKey, otpCode);

		if (!result.valid) {
			return fail(401, {
				error: '確認コードが正しくないか、有効期限が切れています',
				email,
				otpStep: true,
				otpSessionKey,
				maskedEmail: email ? getMaskedEmail(email) : '',
			});
		}

		// OTP検証成功 — 保留中のトークンを取得してCookieにセット
		const pendingToken = cookies.get(PENDING_TOKEN_COOKIE);
		if (!pendingToken) {
			return fail(401, { error: 'セッションが期限切れです。もう一度ログインしてください', email });
		}

		cookies.delete(PENDING_TOKEN_COOKIE, { path: '/' });
		setIdentityCookie(cookies, pendingToken);
		redirect(302, '/admin');
	},
};

/** devモード: ダミーユーザーで認証 */
async function handleDevLogin(
	email: string,
	password: string,
	cookies: import('@sveltejs/kit').Cookies,
) {
	const user = authenticateDevUser(email, password);
	if (!user) {
		return fail(401, { error: 'メールアドレスまたはパスワードが正しくありません', email });
	}

	const idToken = await signDevIdentityToken({
		userId: user.userId,
		email: user.email,
	});

	cookies.set(IDENTITY_COOKIE_NAME, idToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: COOKIE_SECURE,
		maxAge: 60 * 60,
	});

	const target = user.role === 'child' ? '/switch' : '/admin';
	redirect(302, target);
}

/** 本番: Cognito InitiateAuth API で認証 */
async function handleCognitoLogin(
	email: string,
	password: string,
	cookies: import('@sveltejs/kit').Cookies,
) {
	// アカウントロックアウトチェック
	const lockout = await checkAccountLockout(email);
	if (lockout.locked) {
		return fail(401, {
			error: `アカウントがロックされています。${lockout.remainingMinutes}分後にお試しください`,
			email,
		});
	}

	const result = await authenticateWithCognito(email, password);

	if (!result.success) {
		// MFA チャレンジ: セッション情報をクライアントに返す（失敗ではない）
		if (result.error === 'MFA_REQUIRED') {
			return fail(200, {
				mfaStep: true,
				session: result.session,
				challengeName: result.challengeName,
				email,
			});
		}
		// 認証失敗をカウント
		if (result.error === 'INVALID_CREDENTIALS' || result.error === 'USER_NOT_FOUND') {
			const lockResult = await recordLoginFailure(email);
			if (lockResult.locked) {
				return fail(401, {
					error: `ログインに10回失敗したため、アカウントがロックされました。${lockResult.remainingMinutes}分後にお試しください`,
					email,
				});
			}
		}
		return fail(401, { error: result.message, email });
	}

	// 認証成功: ロックアウトカウンターをリセット
	await resetLoginFailures(email);

	// Email OTPが必要か判定し、必要なら OTP ステップへ
	return finishAuthOrStartOtp(email, result.idToken, cookies);
}

/**
 * 認証成功後の共通処理: Email OTP が必要なら OTP ステップへ遷移、不要ならセッション確立
 */
async function finishAuthOrStartOtp(
	email: string,
	idToken: string,
	cookies: import('@sveltejs/kit').Cookies,
) {
	if (isEmailOtpRequired(email)) {
		// idToken を一時的な httpOnly Cookie に保存（OTP 検証成功後に使う）
		cookies.set(PENDING_TOKEN_COOKIE, idToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: COOKIE_SECURE,
			maxAge: 5 * 60, // 5分（OTP TTL 3分 + 余裕）
		});

		const otpSessionKey = await sendEmailOtp(email);
		const maskedEmail = getMaskedEmail(email);

		return fail(200, {
			otpStep: true,
			otpSessionKey,
			maskedEmail,
			email,
		});
	}

	// OTP不要: 直接セッション確立
	setIdentityCookie(cookies, idToken);
	redirect(302, '/admin');
}
