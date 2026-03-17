import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '$lib/domain/validation/auth';
import { logger } from '$lib/server/logger';
import { validateSession } from '$lib/server/services/auth-service';
import { isSetupRequired } from '$lib/server/services/setup-service';
import { type Handle, type HandleServerError, redirect } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const start = Date.now();

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

	// 4) ルート保護
	const path = event.url.pathname;

	// セットアップ未完了時は /setup へリダイレクト
	if (!path.startsWith('/setup') && !path.startsWith('/_app') && !path.startsWith('/favicon')) {
		if (isSetupRequired()) {
			redirect(302, '/setup');
		}
	}

	// セットアップ完了済みなら /setup へのアクセスをブロック
	if (path.startsWith('/setup') && !isSetupRequired()) {
		redirect(302, '/');
	}

	if (path.startsWith('/admin') && !authenticated) {
		redirect(302, '/login');
	}

	if (path === '/login' && authenticated) {
		redirect(302, '/admin');
	}

	const response = await resolve(event);

	// 5) リクエストログ（静的ファイルは除外）
	if (!path.startsWith('/_app/') && !path.startsWith('/favicon')) {
		logger.request(event.request.method, path, response.status, Date.now() - start);
	}

	return response;
};

// サーバーエラーハンドラ: 500エラーの詳細をログに記録
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const method = event.request.method;
	const path = event.url.pathname;

	logger.error(`[${status}] ${method} ${path}: ${message}`, {
		method,
		path,
		status,
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});

	return { message: 'Internal Server Error' };
};
