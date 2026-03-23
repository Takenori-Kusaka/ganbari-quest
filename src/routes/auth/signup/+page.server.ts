// /auth/signup — ユーザー登録
// Cognito SignUp + メール認証コード確認

import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import { confirmSignUp, signUpWithCognito } from '$lib/server/auth/providers/cognito-direct-auth';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const authMode = getAuthMode();

	// local モードやdevモードでは登録不要
	if (authMode === 'local' || isCognitoDevMode()) {
		redirect(302, '/auth/login');
	}

	// 既にログイン済み
	if (locals.identity) {
		redirect(302, '/admin');
	}

	return {};
};

export const actions: Actions = {
	signup: async ({ request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;
		const passwordConfirm = formData.get('passwordConfirm') as string;

		if (!email || !password || !passwordConfirm) {
			return fail(400, { error: '全ての項目を入力してください', email });
		}

		if (password !== passwordConfirm) {
			return fail(400, { error: 'パスワードが一致しません', email });
		}

		if (password.length < 8) {
			return fail(400, { error: 'パスワードは8文字以上で入力してください', email });
		}

		const result = await signUpWithCognito(email, password);

		if (!result.success) {
			return fail(400, { error: result.message, email });
		}

		// メール認証が必要（通常のケース）
		if (!result.userConfirmed) {
			return { confirmStep: true, email };
		}

		// 即時確認（auto-verify が有効な場合）
		redirect(302, '/auth/login?registered=true');
	},

	confirm: async ({ request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const code = formData.get('code') as string;

		if (!email || !code) {
			return fail(400, { error: '確認コードを入力してください', email, confirmStep: true });
		}

		const result = await confirmSignUp(email, code);

		if (!result.success) {
			return fail(400, { error: result.message, email, confirmStep: true });
		}

		redirect(302, '/auth/login?registered=true');
	},
};
