// /auth/signup — ユーザー登録
// Cognito SignUp + メール認証コード確認 + 確認後の自動ログイン

import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	authenticateWithCognito,
	confirmSignUp,
	signUpWithCognito,
} from '$lib/server/auth/providers/cognito-direct-auth';
import { setIdentityCookie } from '$lib/server/auth/providers/cognito-oauth';
import { logger } from '$lib/server/logger';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const _tenantId = locals.context?.tenantId;
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
	signup: async ({ request, locals }) => {
		const _tenantId = locals.context?.tenantId;
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

	confirm: async ({ request, cookies, locals }) => {
		const _tenantId = locals.context?.tenantId;
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const code = formData.get('code') as string;
		const password = formData.get('password') as string;

		if (!email || !code) {
			return fail(400, { error: '確認コードを入力してください', email, confirmStep: true });
		}

		const confirmResult = await confirmSignUp(email, code);

		if (!confirmResult.success) {
			return fail(400, { error: confirmResult.message, email, confirmStep: true });
		}

		// 確認成功 → パスワードがあれば自動ログインを試みる
		if (password) {
			const loginResult = await autoLogin(email, password, cookies);
			if (loginResult === 'ok') {
				redirect(302, '/admin');
			}
		}

		// 自動ログインできなかった場合はログインページへ
		redirect(302, '/auth/login?registered=true');
	},
};

/** 確認後の自動ログイン（失敗してもエラーにしない） */
async function autoLogin(
	email: string,
	password: string,
	cookies: import('@sveltejs/kit').Cookies,
): Promise<'ok' | 'fallback'> {
	try {
		const result = await authenticateWithCognito(email, password);
		if (result.success) {
			setIdentityCookie(cookies, result.idToken);
			return 'ok';
		}
		// MFA チャレンジやエラーの場合はフォールバック
		return 'fallback';
	} catch (e) {
		logger.warn('[AUTH] Auto-login after signup failed', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return 'fallback';
	}
}
