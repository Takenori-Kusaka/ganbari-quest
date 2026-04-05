// /auth/forgot-password — パスワードリセット
// Step 1: メールアドレス入力 → Cognito ForgotPassword API で確認コード送信
// Step 2: 確認コード + 新パスワード入力 → Cognito ConfirmForgotPassword API でリセット

import { fail, redirect } from '@sveltejs/kit';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	confirmForgotPassword,
	forgotPassword,
} from '$lib/server/auth/providers/cognito-direct-auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const authMode = getAuthMode();

	// local モードやdevモードではパスワードリセット不要
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
	requestReset: async ({ request }) => {
		const formData = await request.formData();
		const email = (formData.get('email') as string)?.trim();

		if (!email) {
			return fail(400, { error: 'メールアドレスを入力してください' });
		}

		const result = await forgotPassword(email);

		if (!result.success) {
			return fail(400, { error: result.message, email });
		}

		// 成功 → 確認コード入力ステップへ
		return { confirmStep: true, email };
	},

	confirmReset: async ({ request }) => {
		const formData = await request.formData();
		const email = (formData.get('email') as string)?.trim();
		const code = (formData.get('code') as string)?.replace(/\s/g, '');
		const newPassword = formData.get('newPassword') as string;
		const newPasswordConfirm = formData.get('newPasswordConfirm') as string;

		if (!email || !code || !newPassword) {
			return fail(400, {
				error: '全ての項目を入力してください',
				email,
				confirmStep: true,
			});
		}

		if (newPassword !== newPasswordConfirm) {
			return fail(400, {
				error: 'パスワードが一致しません',
				email,
				confirmStep: true,
			});
		}

		if (newPassword.length < 8) {
			return fail(400, {
				error: 'パスワードは8文字以上で入力してください',
				email,
				confirmStep: true,
			});
		}

		const result = await confirmForgotPassword(email, code, newPassword);

		if (!result.success) {
			return fail(400, {
				error: result.message,
				email,
				confirmStep: true,
			});
		}

		// 成功 → ログインページへリダイレクト
		redirect(302, '/auth/login?passwordReset=true');
	},
};
