// /auth/login — Email/Password ログイン
// AUTH_MODE=cognito 時に使用
// - devモード: ダミーユーザーで認証
// - 本番: Cognito InitiateAuth API で直接認証（Hosted UI は使わない）

import { fail, redirect } from '@sveltejs/kit';
import { DEMO_LABELS } from '$lib/domain/labels';
import { IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import {
	encodeNextParam,
	LOGIN_NEXT_PARAM,
	resolveSafeNextPath,
} from '$lib/domain/validation/login-redirect';
import { getAuthMode, getAuthProvider, isCognitoDevMode } from '$lib/server/auth/factory';
import {
	CHILD_LANDING,
	PARENT_LANDING,
	resolvePostLoginLanding,
} from '$lib/server/auth/post-login-landing';
import { authenticateDevUser } from '$lib/server/auth/providers/cognito-dev';
import { signDevIdentityToken } from '$lib/server/auth/providers/cognito-dev-jwt';
import {
	authenticateWithCognito,
	resendConfirmationCode,
	respondToMfaChallenge,
} from '$lib/server/auth/providers/cognito-direct-auth';
import { setIdentityCookie, setRefreshCookie } from '$lib/server/auth/providers/cognito-oauth';
import type { Role } from '$lib/server/auth/types';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';
import {
	checkAccountLockout,
	recordLoginFailure,
	resetLoginFailures,
} from '$lib/server/security/account-lockout';
import type { Actions, PageServerLoad } from './$types';

/**
 * ログイン後の着地先 (#4701)。`?next=` が安全な相対パス (同一オリジン、`/` 始まり、`//` `/\` 不可) なら
 * それを、無ければロール既定 (child → /switch、それ以外 → /admin) を返す。
 * child が `/admin/...` を next に持っていても hooks の認可が /switch へ戻すため、ここでは役割で絞らない。
 */
function resolveLoginTarget(next: string | null | undefined, role: Role | null) {
	// 着地先の既定値は #4641 の SSOT (post-login-landing.ts) を参照する
	return resolveSafeNextPath(next) ?? (role === 'child' ? CHILD_LANDING : PARENT_LANDING);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const _tenantId = locals.context?.tenantId;
	const authMode = getAuthMode();
	// #4701: `?next=` は検証済みの値だけを page data に載せる (外部 URL / `//evil` は null = 無視)
	const next = resolveSafeNextPath(url.searchParams.get(LOGIN_NEXT_PARAM));

	// #4712: demo Lambda には Cognito が無く、ログインフォームを出しても送信が write no-op に
	// なるだけ (「何も起きない」着地)。本番 host のログイン画面へ送る (signup と同型)。
	if (locals.isDemo) {
		redirect(302, DEMO_LABELS.loginHref);
	}

	// local モードではログイン不要 → /admin へ
	if (authMode === 'local') {
		redirect(302, next ?? '/admin');
	}

	// 既にログイン済み → next または /admin へ
	if (locals.identity) {
		redirect(302, resolveLoginTarget(next, locals.context?.role ?? null));
	}

	return {
		devMode: isCognitoDevMode(),
		next,
	};
};

export const actions: Actions = {
	login: async (event) => {
		const { request, locals } = event;
		const _tenantId = locals.context?.tenantId;
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;
		// #4701: hidden input で往復した next (再検証する。form 改竄で外部 URL を入れても無視される)
		const next = resolveSafeNextPath(formData.get(LOGIN_NEXT_PARAM)?.toString());

		if (!email || !password) {
			return fail(400, { error: 'メールアドレスとパスワードを入力してください', email });
		}

		const devMode = isCognitoDevMode();

		if (devMode) {
			return handleDevLogin(email, password, event, next);
		}

		return handleCognitoLogin(email, password, event, next);
	},

	confirmCode: async (event) => {
		const { request, cookies } = event;
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const code = (formData.get('code') as string)?.replace(/\s/g, '');
		const password = formData.get('password') as string;
		const next = resolveSafeNextPath(formData.get(LOGIN_NEXT_PARAM)?.toString());

		if (!email || !code) {
			return fail(400, {
				error: '確認コードを入力してください',
				email,
				confirmStep: true,
			});
		}

		const { confirmSignUp } = await import('$lib/server/auth/providers/cognito-direct-auth');

		const confirmResult = await confirmSignUp(email, code);

		if (!confirmResult.success) {
			return fail(400, {
				error: confirmResult.message,
				email,
				confirmStep: true,
			});
		}

		// 確認成功 → パスワードがあれば自動ログイン
		if (password) {
			const loginResult = await authenticateWithCognito(email, password);
			if (loginResult.success) {
				await resetLoginFailures(email);
				establishSession(cookies, loginResult);
				// #4641 / #4701: 子供ロールは /admin に入れない。着地先はロールで決め、
				// 検証済みの next は親ロールにだけ preferredPath として適用する
				redirect(302, await landingAfterSession(event, next));
			}
		}

		// 自動ログインできなかった場合はログインページへ (確認完了を表示、next は引き継ぐ)
		redirect(302, withNext('/auth/login?confirmed=true', next));
	},

	resendFromLogin: async ({ request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;

		if (!email) {
			return fail(400, {
				error: 'メールアドレスが指定されていません',
				confirmStep: true,
				email: '',
			});
		}

		const result = await resendConfirmationCode(email);

		if (!result.success) {
			return fail(400, {
				error: result.message,
				confirmStep: true,
				email,
			});
		}

		return {
			confirmStep: true,
			email,
			resent: true,
		};
	},

	mfa: async (event) => {
		const { request, cookies, locals } = event;
		const _tenantId = locals.context?.tenantId;
		const formData = await request.formData();
		const session = formData.get('session') as string;
		const mfaCode = (formData.get('mfaCode') as string)?.replace(/\s/g, '');
		const challengeName = formData.get('challengeName') as string;
		const email = formData.get('email') as string;
		const next = resolveSafeNextPath(formData.get(LOGIN_NEXT_PARAM)?.toString());

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

		// MFA成功 → セッション確立
		establishSession(cookies, result);
		// #4641 / #4701: 子供ロールは /admin に入れない。着地先はロールで決め、
		// 検証済みの next は親ロールにだけ preferredPath として適用する
		redirect(302, await landingAfterSession(event, next));
	},
};

/** `next` があれば query に付けて返す (login 画面への戻りで引き継ぐ用)。 */
function withNext(path: string, next: string | null): string {
	if (!next) return path;
	const sep = path.includes('?') ? '&' : '?';
	return `${path}${sep}${LOGIN_NEXT_PARAM}=${encodeNextParam(next)}`;
}

/**
 * 認証成功時のセッション cookie 確立
 * identity cookie (1時間) + refresh cookie (30日、#1365 / #3022) をセットで保存する
 */
function establishSession(
	cookies: import('@sveltejs/kit').Cookies,
	result: { idToken: string; refreshToken?: string },
): void {
	setIdentityCookie(cookies, result.idToken);
	if (result.refreshToken) {
		setRefreshCookie(cookies, result.refreshToken);
	}
}

/** devモード: ダミーユーザーで認証 */
async function handleDevLogin(
	email: string,
	password: string,
	event: import('@sveltejs/kit').RequestEvent,
	next: string | null,
) {
	const { cookies } = event;
	const user = authenticateDevUser(email, password);
	if (!user) {
		return fail(401, { error: 'メールアドレスまたはパスワードが正しくありません', email });
	}

	const idToken = await signDevIdentityToken({
		userId: user.userId,
		email: user.email,
		groups: user.groups,
		federated: user.federated,
		// #4266: /ops は ops group + MFA を要求する。dev の ops ユーザは MFA 済として発行する
		mfa: user.mfa,
	});

	cookies.set(IDENTITY_COOKIE_NAME, idToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: COOKIE_SECURE,
		maxAge: 60 * 60,
	});

	// #4641: 本番経路 (handleCognitoLogin) と同じ SSOT で着地先を決める。
	// ここだけロール直書きのままだと `npm run dev:cognito` / e2e-cognito-dev レーンでは
	// 子供が常に /switch に留まり、本 Issue の「再ログインはホーム直行」が成立しない。
	// #4701: 検証済みの next は親ロールにだけ preferredPath として適用される。
	redirect(302, await landingAfterSession(event, next));
}

/**
 * #4641: セッション確立後の着地先を決める。
 *
 * 直前に積んだ identity cookie から **provider 経由で** identity を解決する
 * (`/auth/callback` と同じ形)。ID token の検証方式は provider ごとに異なり
 * (本番 = Cognito JWKS の RS256 / `COGNITO_DEV_MODE` = `cognito-dev-jwt` の HS256 +
 * ローカル issuer・audience)、本番用 verifier を直接呼ぶと dev の token が検証できず
 * ロール判定が落ちて着地先が壊れるため、検証は provider に委ねる。
 *
 * 解決できないときは従来どおり親画面へ送る — 次のリクエストで hooks が正しい判定をやり直すため、
 * ここで止めるより一度進ませた方が dead-end を作らない。
 *
 * #4701: 検証済みの `next` は `preferredPath` として渡す。resolvePostLoginLanding は
 * 子供ロールには preferredPath を適用しない (親向け画面へ送ると認可で跳ね返るため)。
 */
async function landingAfterSession(
	event: import('@sveltejs/kit').RequestEvent,
	next: string | null,
): Promise<string> {
	try {
		const identity = await getAuthProvider().resolveIdentity(event);
		if (!identity) return resolveLoginTarget(next, null);
		return await resolvePostLoginLanding(event, identity, next ?? undefined);
	} catch (e) {
		logger.warn('[AUTH] ログイン後の着地先を解決できず親画面へ送る', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return resolveLoginTarget(next, null);
	}
}

/** 本番: Cognito InitiateAuth API で認証 */
async function handleCognitoLogin(
	email: string,
	password: string,
	event: import('@sveltejs/kit').RequestEvent,
	next: string | null,
) {
	const cookies = event.cookies;
	// アカウントロックアウトチェック
	const lockout = await checkAccountLockout(email);
	if (lockout.locked) {
		return fail(401, {
			error: `アカウントがロックされています。${lockout.remainingMinutes}分後にお試しください`,
			email,
		});
	}

	const result = await authenticateWithCognito(email, password);

	if (!result.success) {
		// MFA チャレンジ: セッション情報をクライアントに返す（失敗ではない）
		if (result.error === 'MFA_REQUIRED') {
			return fail(200, {
				mfaStep: true,
				session: result.session,
				challengeName: result.challengeName,
				email,
			});
		}

		// UNCONFIRMED ユーザー: 確認コードを自動再送して確認画面へ遷移
		if (result.error === 'NOT_CONFIRMED') {
			try {
				const resendResult = await resendConfirmationCode(email);
				if (!resendResult.success) {
					logger.warn('[AUTH] Failed to auto-resend confirmation code', {
						context: { email, error: resendResult.message ?? 'Unknown error' },
					});
					// Still transition to confirm step but with warning
				} else {
					logger.info('[AUTH] Auto-resent confirmation code for unconfirmed user', {
						context: { email },
					});
				}
			} catch (e) {
				logger.warn('[AUTH] Failed to auto-resend confirmation code', {
					context: { error: e instanceof Error ? e.message : String(e) },
				});
			}
			return {
				confirmStep: true,
				email,
			};
		}

		// 認証失敗をカウント
		if (result.error === 'INVALID_CREDENTIALS' || result.error === 'USER_NOT_FOUND') {
			const lockResult = await recordLoginFailure(email);
			if (lockResult.locked) {
				return fail(401, {
					error: `ログインに10回失敗したため、アカウントがロックされました。${lockResult.remainingMinutes}分後にお試しください`,
					email,
				});
			}
		}
		return fail(401, { error: result.message, email });
	}

	// 認証成功: ロックアウトカウンターをリセット → セッション確立 → next または /admin
	await resetLoginFailures(email);
	establishSession(cookies, result);
	// #4641 / #4701: 子供ロールは /admin に入れない。着地先はロールで決め、
	// 検証済みの next は親ロールにだけ preferredPath として適用する
	redirect(302, await landingAfterSession(event, next));
}
