import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '$lib/domain/validation/auth';
import { validateSession } from '$lib/server/services/auth-service';
import { type Handle, redirect } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// 1) セッションCookieからトークン取得
	const sessionToken = event.cookies.get(SESSION_COOKIE_NAME);

	// 2) セッション検証
	let authenticated = false;
	if (sessionToken) {
		const result = validateSession(sessionToken);
		if (result.valid) {
			authenticated = true;
			// セッションがリフレッシュされた場合、Cookieも更新
			if (result.refreshed) {
				event.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
					path: '/',
					httpOnly: true,
					sameSite: 'lax',
					secure: false,
					maxAge: SESSION_MAX_AGE_SECONDS,
				});
			}
		}
	}

	// 3) event.locals にセット
	event.locals.authenticated = authenticated;

	// 4) (parent) グループのルート保護
	//    (parent) はグルーピングルートなので URL には現れない
	//    /admin/* は認証必須、/login は未認証でもアクセス可能
	const path = event.url.pathname;

	if (path.startsWith('/admin') && !authenticated) {
		redirect(302, '/login');
	}

	// 認証済みで /login にアクセスした場合は /admin にリダイレクト
	if (path === '/login' && authenticated) {
		redirect(302, '/admin');
	}

	return resolve(event);
};
