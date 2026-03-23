// /auth/login — Email/Password ログイン
// AUTH_MODE=cognito 時に使用（devモード: ダミー認証、本番: Cognito Hosted UI へリダイレクト）

import { IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import { authenticateDevUser } from '$lib/server/auth/providers/cognito-dev';
import { signDevIdentityToken } from '$lib/server/auth/providers/cognito-dev-jwt';
import { buildAuthorizeUrl } from '$lib/server/auth/providers/cognito-oauth';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
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
	default: async ({ request, cookies }) => {
		const authMode = getAuthMode();
		const devMode = isCognitoDevMode();

		// 本番 Cognito: Hosted UI へリダイレクト
		if (authMode === 'cognito' && !devMode) {
			const authorizeUrl = buildAuthorizeUrl(cookies);
			redirect(302, authorizeUrl);
		}

		// devモード: Email/Password でダミー認証
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (!email || !password) {
			return fail(400, { error: 'メールアドレスとパスワードを入力してください', email });
		}

		const user = authenticateDevUser(email, password);
		if (!user) {
			return fail(401, { error: 'メールアドレスまたはパスワードが正しくありません', email });
		}

		// ダミー JWT を発行して Cookie にセット
		const idToken = await signDevIdentityToken({
			userId: user.userId,
			email: user.email,
		});

		cookies.set(IDENTITY_COOKIE_NAME, idToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false,
			maxAge: 60 * 60, // 1時間
		});

		// ロールに応じたリダイレクト
		const target = user.role === 'child' ? '/switch' : '/admin';
		redirect(302, target);
	},
};
