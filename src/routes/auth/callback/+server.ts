// /auth/callback — Cognito OAuth コールバック
// Authorization Code を受け取り、トークン交換して Cookie にセット

import { type Cookies, redirect } from '@sveltejs/kit';
import {
	LOGIN_NEXT_PARAM,
	OAUTH_NEXT_COOKIE_NAME,
	resolveSafeNextPath,
} from '$lib/domain/validation/login-redirect';
import { OAUTH_PLAN_COOKIE_NAME } from '$lib/domain/validation/signup-plan';
import { getAuthProvider } from '$lib/server/auth/factory';
import { resolvePostLoginLanding } from '$lib/server/auth/post-login-landing';
import {
	exchangeCodeForTokens,
	setIdentityCookie,
	setRefreshCookie,
	verifyOAuthState,
} from '$lib/server/auth/providers/cognito-oauth';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { url, cookies } = event;
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	// Cognito がエラーを返した場合
	if (error) {
		logger.warn('[AUTH] OAuth callback error', {
			context: { error, description: url.searchParams.get('error_description') },
		});
		dropPlanCookie(cookies);
		redirect(302, '/auth/login?error=oauth_failed');
	}

	if (!code || !state) {
		dropPlanCookie(cookies);
		redirect(302, '/auth/login?error=missing_params');
	}

	// CSRF 検証
	if (!verifyOAuthState(state, cookies)) {
		logger.warn('[AUTH] OAuth state mismatch');
		dropPlanCookie(cookies);
		redirect(302, '/auth/login?error=invalid_state');
	}

	// #3025: redirect() は throw するため try 内で成功 redirect を投げると catch に捕まり
	// error redirect に化ける (従来コードの潜在バグ)。成功遷移先は try の外で確定させる。
	let successPath = '/admin';
	try {
		// Authorization Code → Token 交換
		const tokens = await exchangeCodeForTokens(code, cookies);

		// ID Token を Cookie にセット
		setIdentityCookie(cookies, tokens.idToken);

		// Refresh Token を保存してセッションを30日に延長 (#1365)
		if (tokens.refreshToken) {
			setRefreshCookie(cookies, tokens.refreshToken);
		}

		// #3025 / #4701: 「Google で本人確認」(PIN reset 等) や login 画面の `?next=` から来た場合は
		// oauth_next cookie の内部 path へ戻す (open redirect 防止の検証は login-redirect.ts SSOT:
		// "//" と "/\" を拒否。ブラウザは Location の "\" を "/" に正規化するため "/\evil.com" も外部遷移し得る)
		const next = cookies.get(OAUTH_NEXT_COOKIE_NAME);
		if (next) {
			cookies.delete(OAUTH_NEXT_COOKIE_NAME, { path: '/' });
			const safe = resolveSafeNextPath(next);
			if (safe) {
				successPath = safe;
			}
		}
	} catch (e) {
		logger.error('[AUTH] OAuth callback token exchange failed', {
			error: e instanceof Error ? e.message : String(e),
		});
		dropPlanCookie(cookies);
		redirect(302, '/auth/login?error=token_exchange_failed');
	}

	// #4641: 子供ロールは /admin に入れないため、着地先をロールで決める。
	// oauth_next (「Google で本人確認」からの復帰先) は親向け画面なので子供には適用しない。
	// 直前に積んだ identity cookie から所属を解決する (失敗したら従来どおりの着地先へ)
	const identity = await getAuthProvider().resolveIdentity(event);
	// #4702 (QM #4748 再レビュー): 「初回 provisioning か」は **landing 解決より前**に見る。
	// resolvePostLoginLanding → resolveContext が初回ログインの users 行 / テナントを作るため、
	// その後に findUserByEmail を引くと「今作った行」が返って常に既存扱いになり、新規顧客の
	// トライアルが 1 件も始まらない (adv-4748 再検証で検出)。
	const planCookiePresent = cookies.get(OAUTH_PLAN_COOKIE_NAME) !== undefined;
	const email = identity && 'email' in identity ? identity.email : null;
	const firstProvisioning =
		planCookiePresent && email !== null ? await isFirstProvisioning(email) : false;
	const landing = identity
		? await resolvePostLoginLanding(event, identity, successPath)
		: successPath;

	// #4702: 「無料体験をはじめる」から Google で登録した場合は、テナント自動プロビジョニング後に
	// トライアルを開始する必要がある (callback 時点ではまだテナントが無い)。plan cookie があるときだけ
	// /auth/oauth/trial-start を経由させ、そこから本来の着地先 (#4641 のロール別着地) へ進む。
	// Issue #4702 PO 判断は「callback の**初回 provisioning 後**に startTrial」。トライアルを始めるのは
	// **このログインで初めてアカウントが作られる**ときだけで、既存アカウント (再訪者 / 招待で合流済みの
	// parent / Google 連携の child) の Google ログインは「登録」ではない。?plan= が付いていても世帯の
	// 1 回限りのトライアルを消費させない (QM #4748 レビュー: child による世帯 trial 開始と、第三者が
	// 配った `/auth/oauth/google?plan=` リンクからの強制消化を塞ぐ)。
	if (planCookiePresent) {
		if (firstProvisioning) {
			redirect(302, `/auth/oauth/trial-start?${LOGIN_NEXT_PARAM}=${encodeURIComponent(landing)}`);
		}
		dropPlanCookie(cookies);
		logger.info(
			'[SIGNUP] Trial auto-start skipped — existing account signed in with ?plan= (Google)',
			{
				context: { hasIdentity: identity !== null },
			},
		);
	}

	// 認証成功 → ご家族の見守り画面 or oauth_next（resolveContext で自動的にテナント選択される）
	redirect(302, landing);
};

/** #4702 (QM #4748): 失敗分岐で `oauth_plan` cookie を残さない (10 分残ると別アカウントのログインで発火する)。 */
function dropPlanCookie(cookies: Cookies): void {
	cookies.delete(OAUTH_PLAN_COOKIE_NAME, { path: '/' });
}

/**
 * #4702 (QM #4748): この email のアカウントがまだ無い (= このログインで初めて provisioning される) か。
 * 判定できないとき (DB 障害等) は fail-closed で「既存扱い」にし、トライアルを別世帯や既存世帯に
 * 付けない。顧客は設定 > プラン画面から手動で開始できる。
 */
async function isFirstProvisioning(email: string): Promise<boolean> {
	try {
		return (await getRepos().auth.findUserByEmail(email)) === null;
	} catch (e) {
		logger.error('[SIGNUP] Could not determine first provisioning — trial auto-start skipped', {
			error: e instanceof Error ? e.message : String(e),
		});
		return false;
	}
}
