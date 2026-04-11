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
import { startTrial, type TrialTier } from '$lib/server/services/trial-service';
import type { Actions, PageServerLoad } from './$types';

/**
 * #766: /auth/signup?plan=X からのサインアップ時にトライアル自動開始用のティアを決定する。
 * 既知のティア以外（無効値・空文字）は null を返し、呼び出し側でトライアル開始をスキップする。
 */
function parsePlanForTrial(planInput: string | null | undefined): TrialTier | null {
	if (!planInput) return null;
	const normalized = planInput.trim().toLowerCase();
	if (normalized === 'standard' || normalized === 'family') return normalized;
	return null;
}

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
		// #766: /pricing からの遷移で plan パラメータ（standard|family）を引き継ぐ
		const planInput = (formData.get('plan') as string | null) ?? '';
		const agreedTerms = formData.get('agreedTerms') === 'on';
		const agreedPrivacy = formData.get('agreedPrivacy') === 'on';

		if (!agreedTerms || !agreedPrivacy) {
			return fail(400, {
				error: '利用規約とプライバシーポリシーへの同意が必要です',
				email,
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		if (!email || !password || !passwordConfirm) {
			return fail(400, {
				error: '全ての項目を入力してください',
				email,
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		if (password !== passwordConfirm) {
			return fail(400, {
				error: 'パスワードが一致しません',
				email,
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		if (password.length < 8) {
			return fail(400, {
				error: 'パスワードは8文字以上で入力してください',
				email,
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		// ライセンスキーが入力されている場合は事前検証
		if (licenseKeyInput) {
			const keyCheck = await validateLicenseKey(licenseKeyInput);
			if (!keyCheck.valid) {
				return fail(400, {
					error: keyCheck.reason,
					email,
					licenseKey: licenseKeyInput,
					plan: planInput,
				});
			}
		}

		const result = await signUpWithCognito(email, password);

		if (!result.success) {
			return fail(400, {
				error: result.message,
				email,
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		// メール認証が必要（通常のケース）
		if (!result.userConfirmed) {
			return { confirmStep: true, email, licenseKey: licenseKeyInput, plan: planInput };
		}

		// 即時確認（auto-verify が有効な場合）
		redirect(302, '/auth/login?registered=true');
	},

	resend: async ({ request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const licenseKeyInput = (formData.get('licenseKey') as string)?.trim() || '';
		// #766: plan パラメータを再送後も保持
		const planInput = (formData.get('plan') as string | null) ?? '';

		if (!email) {
			return fail(400, {
				error: 'メールアドレスが指定されていません',
				confirmStep: true,
				email: '',
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		const result = await resendConfirmationCode(email);

		if (!result.success) {
			return fail(400, {
				error: result.message,
				confirmStep: true,
				email,
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		return {
			confirmStep: true,
			email,
			licenseKey: licenseKeyInput,
			plan: planInput,
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
		// #766: /pricing からの遷移時の plan パラメータ。トライアル自動開始用
		const planInput = (formData.get('plan') as string | null) ?? '';

		if (!email || !code) {
			return fail(400, {
				error: '確認コードを入力してください',
				email,
				confirmStep: true,
				licenseKey: licenseKeyInput,
				plan: planInput,
			});
		}

		const confirmResult = await confirmSignUp(email, code);

		if (!confirmResult.success) {
			return fail(400, {
				error: confirmResult.message,
				email,
				confirmStep: true,
				licenseKey: licenseKeyInput,
				plan: planInput,
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

		// ライセンスキー紐付け (#795: fire-and-forget を撤廃)
		//
		// 旧実装は fire-and-forget だったため、キーが見つからない / consumed 済み /
		// DB 書き込み失敗などで tenants.plan が更新されず、ユーザーはキーを入力したのに
		// free のまま /admin に入る致命的な不一致が発生していた。
		//
		// 本実装では await して結果を確認し、失敗時はエラーログ + /admin にフォールバック
		// （手動ログイン扱い）する。ここでリダイレクトで確認画面に戻す選択肢もあるが、
		// Cognito の confirmSignUp は既に成功しており戻せないため、tenant 作成まで完了した
		// 上で /admin に進み、/admin 側で「ライセンスキー適用失敗」を通知するのが現実的。
		if (licenseKeyInput) {
			try {
				const consumeResult = await consumeLicenseKey(licenseKeyInput, tenantId);
				if (!consumeResult.ok) {
					logger.warn('[SIGNUP] License key consume rejected', {
						context: {
							reason: consumeResult.reason,
							tenantId,
							keyPrefix: licenseKeyInput.slice(0, 7),
						},
					});
				} else {
					logger.info('[SIGNUP] License key consumed at signup', {
						context: {
							tenantId,
							plan: consumeResult.plan,
							planExpiresAt: consumeResult.planExpiresAt ?? 'never',
						},
					});
				}
			} catch (err) {
				logger.error('[SIGNUP] License key consumption threw', {
					context: {
						error: err instanceof Error ? err.message : String(err),
						tenantId,
					},
				});
			}
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

		// #766: /auth/signup?plan=X からの遷移ならトライアルを自動開始する
		//
		// 条件:
		//  - plan パラメータが 'standard' または 'family' の有効値
		//  - ライセンスキー未指定（指定されている場合はライセンスキーが優先。consume 失敗時も
		//    ユーザー意図として「ライセンスキーで登録」が明確なので、トライアルは開始しない）
		//
		// 失敗（既に使用済み等）は best-effort でログのみ記録し /admin に進む。
		// /pricing の CTA からは新規テナントでのみ遷移する想定だが、万一 trialUsed=true でも
		// startTrial() 側で拒否されて false が返るだけで致命的影響はない。
		const trialTier = parsePlanForTrial(planInput);
		if (trialTier && !licenseKeyInput) {
			try {
				const started = await startTrial({
					tenantId,
					source: 'user_initiated',
					tier: trialTier,
				});
				if (started) {
					logger.info('[SIGNUP] Trial auto-started from pricing flow', {
						context: { tenantId, tier: trialTier },
					});
				} else {
					logger.info('[SIGNUP] Trial auto-start rejected (already used/active)', {
						context: { tenantId, tier: trialTier },
					});
				}
			} catch (err) {
				logger.error('[SIGNUP] Trial auto-start threw', {
					context: {
						error: err instanceof Error ? err.message : String(err),
						tenantId,
						tier: trialTier,
					},
				});
			}
		}

		// 正常完了
		redirect(302, '/admin');
	},
};
