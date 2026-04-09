// /auth/signup — ユーザー登録
// Cognito SignUp + メール認証コード確認 + 確認後の自動ログイン

import { fail, redirect } from '@sveltejs/kit';
import { getAuthMode, getAuthProvider, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	authenticateWithCognito,
	confirmSignUp,
	resendConfirmationCode,
	signUpWithCognito,
} from '$lib/server/auth/providers/cognito-direct-auth';
import { verifyIdentityToken } from '$lib/server/auth/providers/cognito-jwt';
import { setIdentityCookie } from '$lib/server/auth/providers/cognito-oauth';
import type { Identity } from '$lib/server/auth/types';
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

	/**
	 * #589: 確認コード検証 → 自動ログイン → tenant provisioning → consent 記録 → /admin
	 *
	 * 旧実装は「tenantId が未確定（'unknown' フォールバック）の状態で recordConsent を呼ぼうとし、
	 * if (tenantId !== 'unknown') 分岐で常にスキップされる」バグにより、新規ユーザーが
	 * /admin にアクセスした瞬間 hooks.server.ts の consent チェックで /consent へ無限リダイレクト
	 * される致命的問題があった。
	 *
	 * 本実装では以下の順序を厳守する:
	 *   1. confirmSignUp で Cognito の確認コード検証
	 *   2. authenticateWithCognito でトークン取得
	 *   3. setIdentityCookie で identity cookie を設定
	 *   4. authProvider.resolveContext で tenant を provisioning（初回ユーザーは新規作成）
	 *   5. recordConsent で同意を記録（tenantId が揃ったこの時点で初めて可能）
	 *   6. consumeLicenseKey と notifyNewSignup（Discord）
	 *   7. /admin へリダイレクト
	 *
	 * 途中で失敗した場合はログを残して /auth/login?registered=true へフォールバック。
	 * 手動ログイン後の初回リクエストで hooks.server.ts が provisionNewUser を走らせるが、
	 * その時点でも consent は未記録のままなので /consent 画面で明示的に同意してもらう。
	 */
	confirm: async (event) => {
		const { request, cookies, getClientAddress } = event;
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

		// パスワードなし（旧フォーム互換）→ 手動ログインへフォールバック
		if (!password) {
			logger.warn('[SIGNUP] Confirm action missing password, falling back to manual login', {
				context: { email },
			});
			redirect(302, '/auth/login?registered=true');
		}

		// 自動ログインを試みる
		const loginResult = await authenticateWithCognito(email, password);
		if (!loginResult.success) {
			logger.warn('[SIGNUP] Auto-login after confirm failed', {
				context: {
					email,
					error: 'error' in loginResult ? loginResult.error : 'unknown',
				},
			});
			redirect(302, '/auth/login?registered=true');
		}

		// Identity Cookie を設定（後続のリクエストで認証済みになる）
		setIdentityCookie(cookies, loginResult.idToken);

		// ID Token から identity を構築（現在のリクエスト内で tenant を解決するため）
		const claims = await verifyIdentityToken(loginResult.idToken);
		if (!claims) {
			logger.error('[SIGNUP] Identity token verification failed after auto-login', {
				context: { email },
			});
			redirect(302, '/auth/login?registered=true');
		}

		const identity: Identity = {
			type: 'cognito',
			userId: claims.sub,
			email: claims.email,
		};

		// Tenant を provisioning（初回ユーザーなら provisionNewUser が走る）
		const authProvider = getAuthProvider();
		const context = await authProvider.resolveContext(event, identity);

		if (!context) {
			logger.error('[SIGNUP] Failed to provision tenant after signup confirm', {
				context: { email, userId: claims.sub },
			});
			redirect(302, '/auth/login?registered=true');
		}

		const tenantId = context.tenantId;

		// 新規登録通知（Discord）— fire-and-forget
		notifyNewSignup(tenantId, email).catch((err) => {
			logger.warn('[SIGNUP] Discord notification failed', {
				context: { error: err instanceof Error ? err.message : String(err) },
			});
		});

		// ライセンスキー紐付け（fire-and-forget — 失敗しても /admin 遷移は妨げない）
		if (licenseKeyInput) {
			consumeLicenseKey(licenseKeyInput, tenantId).catch((err) => {
				logger.warn('[SIGNUP] License key consumption failed', {
					context: {
						error: err instanceof Error ? err.message : String(err),
						tenantId,
					},
				});
			});
		}

		// Consent 記録（同期実行 — 失敗したら /consent 画面へ誘導）
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') ?? '';
		try {
			await recordConsent(tenantId, claims.sub, ['terms', 'privacy'], ip, ua);
			logger.info('[SIGNUP] Consent recorded at signup', {
				context: { tenantId, userId: claims.sub },
			});
		} catch (err) {
			logger.error('[SIGNUP] Failed to record consent at signup', {
				context: {
					error: err instanceof Error ? err.message : String(err),
					tenantId,
					email,
				},
			});
			// Consent 記録失敗 → /consent 画面で再取得
			redirect(302, '/consent');
		}

		// 正常完了
		redirect(302, '/admin');
	},
};
