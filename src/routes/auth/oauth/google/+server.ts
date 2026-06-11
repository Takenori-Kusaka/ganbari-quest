// /auth/oauth/google — Google OAuth 開始エンドポイント
// Cognito の authorize URL に identity_provider=Google を付与してリダイレクト

import { redirect } from '@sveltejs/kit';
import { buildAuthorizeUrl } from '$lib/server/auth/providers/cognito-oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url: requestUrl }) => {
	// #3025: PIN reset 等の「Google で本人確認」から来た場合、ログイン完了後に元画面へ戻す。
	// open redirect 防止のため内部 path のみ許可: 先頭 "/" の直後に "/" と "\" の両方を拒否する。
	// ブラウザは Location ヘッダの "\" を "/" に正規化するため、"/\evil.com" は
	// protocol-relative "//evil.com" として外部遷移し得る (QM adversarial 指摘)。
	const next = requestUrl.searchParams.get('next');
	if (next && /^\/(?![/\\])/.test(next)) {
		cookies.set('oauth_next', next, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 600,
		});
	}
	const url = buildAuthorizeUrl(cookies, 'Google');
	redirect(302, url);
};
