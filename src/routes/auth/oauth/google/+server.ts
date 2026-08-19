// /auth/oauth/google — Google OAuth 開始エンドポイント
// Cognito の authorize URL に identity_provider=Google を付与してリダイレクト

import { redirect } from '@sveltejs/kit';
import {
	LOGIN_NEXT_PARAM,
	OAUTH_NEXT_COOKIE_NAME,
	resolveSafeNextPath,
} from '$lib/domain/validation/login-redirect';
import {
	OAUTH_PLAN_COOKIE_NAME,
	OAUTH_PLAN_MAX_AGE_SECONDS,
	parsePlanForTrial,
} from '$lib/domain/validation/signup-plan';
import { buildAuthorizeUrl } from '$lib/server/auth/providers/cognito-oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url: requestUrl }) => {
	// #3025: PIN reset 等の「Google で本人確認」/ #4701: login 画面の `?next=` から来た場合、
	// ログイン完了後に元画面へ戻す。open redirect 防止の検証は login-redirect.ts (SSOT) に集約:
	// 内部 path のみ許可 (先頭 "/" の直後の "/" と "\" を拒否。ブラウザは Location ヘッダの "\" を
	// "/" に正規化するため "/\evil.com" は protocol-relative "//evil.com" として外部遷移し得る、
	// QM adversarial 指摘)。
	const next = resolveSafeNextPath(requestUrl.searchParams.get(LOGIN_NEXT_PARAM));
	if (next) {
		cookies.set(OAUTH_NEXT_COOKIE_NAME, next, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 600,
		});
	}
	// #4702: 料金ページ → /auth/signup?plan=X → 「Google で登録」の plan を往復させる。
	// callback 後に /auth/oauth/trial-start がこの cookie を読み、メール登録経路と同じ startTrial を呼ぶ。
	const plan = parsePlanForTrial(requestUrl.searchParams.get('plan'));
	if (plan) {
		cookies.set(OAUTH_PLAN_COOKIE_NAME, plan, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: OAUTH_PLAN_MAX_AGE_SECONDS,
		});
	}

	const url = buildAuthorizeUrl(cookies, 'Google');
	redirect(302, url);
};
