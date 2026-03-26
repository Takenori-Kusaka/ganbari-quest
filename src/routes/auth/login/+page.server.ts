// /auth/login — Email/Password ログイン
// AUTH_MODE=cognito 時に使用
// - devモード: ダミーユーザーで認証
// - 本番: Cognito InitiateAuth API で直接認証（Hosted UI は使わない）

import { IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import { authenticateDevUser } from '$lib/server/auth/providers/cognito-dev';
import { signDevIdentityToken } from '$lib/server/auth/providers/cognito-dev-jwt';
import {
	authenticateWithCognito,
	respondToMfaChallenge,
} from '$lib/server/auth/providers/cognito-direct-auth';
import { setIdentityCookie } from '$lib/server/auth/providers/cognito-oauth';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

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

		setIdentityCookie(cookies, result.idToken);
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
		secure: false,
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
	const result = await authenticateWithCognito(email, password);

	if (!result.success) {
		// MFA チャレンジ: セッション情報をクライアントに返す
		if (result.error === 'MFA_REQUIRED') {
			return fail(200, {
				mfaStep: true,
				session: result.session,
				challengeName: result.challengeName,
				email,
			});
		}
		return fail(401, { error: result.message, email });
	}

	// Cognito JWT を Cookie にセット
	setIdentityCookie(cookies, result.idToken);

	// ロール判定は resolveContext で行われるので /admin にリダイレクト
	redirect(302, '/admin');
}
