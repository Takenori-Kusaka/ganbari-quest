// /auth/signup — ユーザー登録
// Cognito SignUp + メール認証コード確認 + 確認後の自動ログイン

import { fail, redirect } from '@sveltejs/kit';
import { getAuthMode, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	authenticateWithCognito,
	confirmSignUp,
	resendConfirmationCode,
	signUpWithCognito,
} from '$lib/server/auth/providers/cognito-direct-auth';
import { setIdentityCookie } from '$lib/server/auth/providers/cognito-oauth';
import { logger } from '$lib/server/logger';
import { recordConsent } from '$lib/server/services/consent-service';
import { notifyNewSignup } from '$lib/server/services/discord-notify-service';
import { consumeLicenseKey, validateLicenseKey } from '$lib/server/services/license-key-service';
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
		const licenseKeyInput = (formData.get('licenseKey') as string)?.trim() || '';
		const agreedTerms = formData.get('agreedTerms') === 'on';
		const agreedPrivacy = formData.get('agreedPrivacy') === 'on';

		if (!agreedTerms || !agreedPrivacy) {
			return fail(400, {
				error: '利用規約とプライバシーポリシーへの同意が必要です',
				email,
				licenseKey: licenseKeyInput,
			});
		}

		if (!email || !password || !passwordConfirm) {
			return fail(400, {
				error: '全ての項目を入力してください',
				email,
				licenseKey: licenseKeyInput,
			});
		}

		if (password !== passwordConfirm) {
			return fail(400, { error: 'パスワードが一致しません', email, licenseKey: licenseKeyInput });
		}

		if (password.length < 8) {
			return fail(400, {
				error: 'パスワードは8文字以上で入力してください',
				email,
				licenseKey: licenseKeyInput,
			});
		}

		// ライセンスキーが入力されている場合は事前検証
		if (licenseKeyInput) {
			const keyCheck = await validateLicenseKey(licenseKeyInput);
			if (!keyCheck.valid) {
				return fail(400, { error: keyCheck.reason, email, licenseKey: licenseKeyInput });
			}
		}

		const result = await signUpWithCognito(email, password);

		if (!result.success) {
			return fail(400, { error: result.message, email, licenseKey: licenseKeyInput });
		}

		// メール認証が必要（通常のケース）
		if (!result.userConfirmed) {
			return { confirmStep: true, email, licenseKey: licenseKeyInput };
		}

		// 即時確認（auto-verify が有効な場合）
		redirect(302, '/auth/login?registered=true');
	},

	resend: async ({ request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const licenseKeyInput = (formData.get('licenseKey') as string)?.trim() || '';

		if (!email) {
			return fail(400, {
				error: 'メールアドレスが指定されていません',
				confirmStep: true,
				email: '',
				licenseKey: licenseKeyInput,
			});
		}

		const result = await resendConfirmationCode(email);

		if (!result.success) {
			return fail(400, {
				error: result.message,
				confirmStep: true,
				email,
				licenseKey: licenseKeyInput,
			});
		}

		return {
			confirmStep: true,
			email,
			licenseKey: licenseKeyInput,
			resent: true,
		};
	},

	confirm: async ({ request, cookies, locals, getClientAddress }) => {
		const _tenantId = locals.context?.tenantId;
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const code = (formData.get('code') as string)?.replace(/\s/g, '');
		const password = formData.get('password') as string;
		const licenseKeyInput = (formData.get('licenseKey') as string)?.trim() || '';

		if (!email || !code) {
			return fail(400, {
				error: '確認コードを入力してください',
				email,
				confirmStep: true,
				licenseKey: licenseKeyInput,
			});
		}

		const confirmResult = await confirmSignUp(email, code);

		if (!confirmResult.success) {
			return fail(400, {
				error: confirmResult.message,
				email,
				confirmStep: true,
				licenseKey: licenseKeyInput,
			});
		}

		// 新規登録通知（Discord）
		const tenantId = locals.context?.tenantId ?? 'unknown';
		notifyNewSignup(tenantId, email).catch(() => {});

		// ライセンスキーが入力されていた場合、テナントに紐付け
		if (licenseKeyInput && tenantId !== 'unknown') {
			consumeLicenseKey(licenseKeyInput, tenantId).catch((err) => {
				logger.warn('[SIGNUP] License key consumption failed', {
					error: err instanceof Error ? err.message : String(err),
				});
			});
		}

		// 同意記録（サインアップ完了後に記録）
		if (tenantId !== 'unknown') {
			const userId = locals.identity?.type === 'cognito' ? locals.identity.userId : 'unknown';
			const ip = getClientAddress();
			const ua = request.headers.get('user-agent') ?? '';
			recordConsent(tenantId, userId, ['terms', 'privacy'], ip, ua).catch((err) => {
				logger.warn('[CONSENT] Failed to record consent at signup', {
					error: err instanceof Error ? err.message : String(err),
				});
			});
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
