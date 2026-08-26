// /auth/signup — ユーザー登録
// Cognito SignUp + メール認証コード確認 + 確認後の自動ログイン

import { fail, redirect } from '@sveltejs/kit';
import { parseSignupPlanParam } from '$lib/domain/validation/signup-plan';
import { getAuthMode, getAuthProvider, isCognitoDevMode } from '$lib/server/auth/factory';
import { landingForRole } from '$lib/server/auth/post-login-landing';
import {
	authenticateWithCognito,
	confirmSignUp,
	resendConfirmationCode,
	signUpWithCognito,
} from '$lib/server/auth/providers/cognito-direct-auth';
import { verifyIdentityToken } from '$lib/server/auth/providers/cognito-jwt';
import { setIdentityCookie, setRefreshCookie } from '$lib/server/auth/providers/cognito-oauth';
import type { Identity } from '$lib/server/auth/types';
import { logger } from '$lib/server/logger';
import { recordConsent } from '$lib/server/services/consent-service';
import { startTrial, TRIAL_TIER } from '$lib/server/services/trial-service';
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
		// #766: /pricing からの遷移で plan パラメータ（standard|family）を引き継ぐ
		const planInput = (formData.get('plan') as string | null) ?? '';
		const agreedTerms = formData.get('agreedTerms') === 'on';
		const agreedPrivacy = formData.get('agreedPrivacy') === 'on';

		if (!agreedTerms || !agreedPrivacy) {
			return fail(400, {
				error: '利用規約とプライバシーポリシーへの同意が必要です',
				email,
				plan: planInput,
			});
		}

		if (!email || !password || !passwordConfirm) {
			return fail(400, {
				error: '全ての項目を入力してください',
				email,
				plan: planInput,
			});
		}

		if (password !== passwordConfirm) {
			return fail(400, {
				error: 'パスワードが一致しません',
				email,
				plan: planInput,
			});
		}

		if (password.length < 8) {
			return fail(400, {
				error: 'パスワードは8文字以上で入力してください',
				email,
				plan: planInput,
			});
		}

		const result = await signUpWithCognito(email, password);

		if (!result.success) {
			return fail(400, {
				error: result.message,
				email,
				plan: planInput,
			});
		}

		// メール認証が必要（通常のケース）
		if (!result.userConfirmed) {
			return { confirmStep: true, email, plan: planInput };
		}

		// 即時確認（auto-verify が有効な場合）
		redirect(302, '/auth/login?registered=true');
	},

	resend: async ({ request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		// #766: plan パラメータを再送後も保持
		const planInput = (formData.get('plan') as string | null) ?? '';

		if (!email) {
			return fail(400, {
				error: 'メールアドレスが指定されていません',
				confirmStep: true,
				email: '',
				plan: planInput,
			});
		}

		const result = await resendConfirmationCode(email);

		if (!result.success) {
			return fail(400, {
				error: result.message,
				confirmStep: true,
				email,
				plan: planInput,
			});
		}

		return {
			confirmStep: true,
			email,
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
	 *   6. /admin へリダイレクト
	 *
	 * 途中で失敗した場合はログを残して /auth/login?registered=true へフォールバック。
	 * 手動ログイン後の初回リクエストで hooks.server.ts が世帯を provisioning するが、
	 * その時点でも consent は未記録のままなので /consent 画面で明示的に同意してもらう。
	 */
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
	confirm: async (event) => {
		const { request, cookies, getClientAddress } = event;
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const code = (formData.get('code') as string)?.replace(/\s/g, '');
		const password = formData.get('password') as string;
		// #766: /pricing からの遷移時の plan パラメータ。トライアル自動開始用
		const planInput = (formData.get('plan') as string | null) ?? '';

		if (!email || !code) {
			return fail(400, {
				error: '確認コードを入力してください',
				email,
				confirmStep: true,
				plan: planInput,
			});
		}

		const confirmResult = await confirmSignUp(email, code);

		if (!confirmResult.success) {
			return fail(400, {
				error: confirmResult.message,
				email,
				confirmStep: true,
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
		// Refresh Token Cookie を設定（#1365: email サインアップも 30 日セッション対象）
		if (loginResult.refreshToken) {
			setRefreshCookie(cookies, loginResult.refreshToken);
		}

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

		// Tenant を provisioning（招待 cookie があれば受諾、無ければ新規作成）
		const authProvider = getAuthProvider();
		const context = await authProvider.resolveContext(event, identity);

		if (!context) {
			// #4636: 招待の受諾に失敗したときはここに来る (新規世帯へフォールバックしないため)。
			// ログイン画面に戻すと「ログイン → /admin → ログイン」の往復になるので、理由と
			// 次アクション (招待の再試行 / 自分の家族グループを作る) を出す画面へ送る。
			// consent は tenantId が決まっていないため記録できず、世帯確定後に /consent が拾う。
			logger.warn('[SIGNUP] Membership undecided after signup confirm', {
				context: { email, userId: claims.sub },
			});
			redirect(302, '/auth/join');
		}

		const tenantId = context.tenantId;
		const consentUserId = context.userId ?? '';

		// #4192: 新規登録の Discord 通知は**持たないと決めた** (#4174 Q2)。サインアップは嬉しいが
		// 見ても何もしない通知で、増やすと incident が埋もれる。実数は GitHub / DB で足りる。
		// 登録の事実は下の `[SIGNUP] Consent recorded at signup` ログ (tenantId 付き) が残す。

		// Consent 記録（同期実行 — 失敗したら /consent 画面へ誘導）
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') ?? '';
		try {
			// #4643: consents.user_id は users.user_id。claims.sub (IdP の sub) は別物
			await recordConsent(tenantId, consentUserId, ['terms', 'privacy'], ip, ua);
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
		//
		// 失敗（既に使用済み等）は best-effort でログのみ記録し /admin に進む。
		// /pricing の CTA からは新規テナントでのみ遷移する想定だが、万一 trialUsed=true でも
		// startTrial() 側で拒否されて false が返るだけで致命的影響はない。
		// #4501: `?plan=` は「どのプランを見て来たか」だけを表し、**トライアルの tier は決めない**
		// (FR-2 により常に TRIAL_TIER = premium)。値域は UI と共有の validator に閉じてあり、
		// 'premium' が silent 棄却される非対称 (GAMMA-SC-04) を解消している。
		const planInterest = parseSignupPlanParam(planInput);
		if (planInterest) {
			try {
				const started = await startTrial({
					tenantId,
					source: 'user_initiated',
					tier: TRIAL_TIER,
				});
				if (started) {
					logger.info('[SIGNUP] Trial auto-started from pricing flow', {
						context: { tenantId, tier: TRIAL_TIER, planInterest },
					});
				} else {
					logger.info('[SIGNUP] Trial auto-start rejected (already used/active)', {
						context: { tenantId, tier: TRIAL_TIER, planInterest },
					});
				}
			} catch (err) {
				logger.error('[SIGNUP] Trial auto-start threw', {
					context: {
						error: err instanceof Error ? err.message : String(err),
						tenantId,
						tier: TRIAL_TIER,
					},
				});
			}
		}

		// 正常完了
		// #4641: 招待で参加した子供ロールは /admin に入れない。着地先はロールで決める
		redirect(302, landingForRole(context.role));
	},
};
