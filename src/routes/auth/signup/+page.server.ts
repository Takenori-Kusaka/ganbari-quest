// /auth/signup — ユーザー登録
// Cognito SignUp + メール認証コード確認 + 確認後の自動ログイン

import { fail, redirect } from '@sveltejs/kit';
import { DEMO_LABELS, SIGNUP_LABELS } from '$lib/domain/labels';
import { parseSignupPlanParam } from '$lib/domain/validation/signup-plan';
import { getAuthMode, getAuthProvider, isCognitoDevMode } from '$lib/server/auth/factory';
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

	// #4712: demo Lambda (AUTH_MODE=anonymous + DATA_SOURCE=demo) には Cognito が無いため、
	// ここでフォームを出すと入力・送信できてしまい write no-op で「何も起きない」着地になる
	// (Google 登録は COGNITO_USER_POOL_ID 未設定で 500)。デモを気に入った見込み客をそのまま
	// 本番の申込画面へ送る (ADR-0048: demo は read-only fixture、申込は本番 host が担う)。
	if (locals.isDemo) {
		redirect(302, DEMO_LABELS.signupHref);
	}

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
		// #4497: 越境移転同意 (個人情報保護法 §28)。旧実装は client 側の submit 制御だけで、
		// JS 無効 / 直接 POST では同意なしで登録が成立していた。server で必須にする。
		const agreedCrossBorder = formData.get('agreedCrossBorder') === 'on';

		if (!agreedTerms || !agreedPrivacy || !agreedCrossBorder) {
			return fail(400, {
				error: SIGNUP_LABELS.errors.consentRequired,
				email,
				plan: planInput,
			});
		}

		if (!email || !password || !passwordConfirm) {
			return fail(400, {
				error: SIGNUP_LABELS.errors.allFieldsRequired,
				email,
				plan: planInput,
			});
		}

		if (password !== passwordConfirm) {
			return fail(400, {
				error: SIGNUP_LABELS.passwordMismatchError,
				email,
				plan: planInput,
			});
		}

		if (password.length < 8) {
			return fail(400, {
				error: SIGNUP_LABELS.errors.passwordTooShort,
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
		// #4497: 同意 3 種の取得済みフラグを確認ステップへ引き継ぐ。実際の記録は tenant が
		// 確定する confirm アクションで行うため、その間これを持ち回る必要がある。
		if (!result.userConfirmed) {
			return { confirmStep: true, email, plan: planInput, consentGiven: true };
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
				error: SIGNUP_LABELS.errors.emailMissing,
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

		// #4497: 同意 3 種 (利用規約 / プライバシーポリシー / 越境移転) は confirm でも server 検証する。
		// consent を実際に記録するのはこのアクション (tenant が確定するのがここ) なので、
		// 「同意の主張が届いていないまま記録だけ走る」経路を作らないため、確認コード検証より前に落とす。
		const agreedTerms = formData.get('agreedTerms') === 'on';
		const agreedPrivacy = formData.get('agreedPrivacy') === 'on';
		const agreedCrossBorder = formData.get('agreedCrossBorder') === 'on';

		if (!agreedTerms || !agreedPrivacy || !agreedCrossBorder) {
			return fail(400, {
				error: SIGNUP_LABELS.errors.consentRequired,
				email,
				confirmStep: true,
				plan: planInput,
			});
		}

		if (!email || !code) {
			return fail(400, {
				error: SIGNUP_LABELS.errors.codeRequired,
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

		// #4192: 新規登録の Discord 通知は**持たないと決めた** (#4174 Q2)。サインアップは嬉しいが
		// 見ても何もしない通知で、増やすと incident が埋もれる。実数は GitHub / DB で足りる。
		// 登録の事実は下の `[SIGNUP] Consent recorded at signup` ログ (tenantId 付き) が残す。

		// Consent 記録（同期実行 — 失敗したら /consent 画面へ誘導）
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') ?? '';
		try {
			// #4497: 越境移転同意 (§28) も terms/privacy と同型に version/ip/ua 付きで永続化する。
			await recordConsent(tenantId, claims.sub, ['terms', 'privacy', 'cross-border'], ip, ua);
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
		redirect(302, '/admin');
	},
};
