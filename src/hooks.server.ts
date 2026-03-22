import { getAuthProvider } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { isSetupRequired } from '$lib/server/services/setup-service';
import { type Handle, type HandleServerError, redirect } from '@sveltejs/kit';

const provider = getAuthProvider();

export const handle: Handle = async ({ event, resolve }) => {
	const start = Date.now();

	// 1) 二層セッション解決
	const identity = await provider.resolveIdentity(event);
	const context = await provider.resolveContext(event, identity);

	event.locals.authenticated = identity !== null;
	event.locals.identity = identity;
	event.locals.context = context;

	// 2) ルート保護
	const path = event.url.pathname;

	// セットアップ未完了時は /setup へリダイレクト
	if (
		!path.startsWith('/setup') &&
		!path.startsWith('/_app') &&
		!path.startsWith('/favicon') &&
		!path.startsWith('/api/health')
	) {
		if (await isSetupRequired()) {
			redirect(302, '/setup');
		}
	}

	// セットアップ完了済みなら /setup へのアクセスをブロック
	if (path.startsWith('/setup') && !(await isSetupRequired())) {
		redirect(302, '/');
	}

	// 認可チェック（Provider 固有のルート保護）
	const authResult = provider.authorize(path, identity, context);
	if (!authResult.allowed) {
		redirect(302, authResult.redirect);
	}

	const response = await resolve(event);

	// 3) リクエストログ（静的ファイルは除外）
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
