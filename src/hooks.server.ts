import { getAuthMode, getAuthProvider } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { checkApiRateLimit, checkAuthRateLimit } from '$lib/server/security/rate-limiter';
import { notifyIncident } from '$lib/server/services/discord-notify-service';
import { isSetupRequired } from '$lib/server/services/setup-service';
import { type Handle, type HandleServerError, redirect } from '@sveltejs/kit';

const provider = getAuthProvider();
const authMode = getAuthMode();

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const COGNITO_DEV_MODE = process.env.COGNITO_DEV_MODE === 'true';

export const handle: Handle = async ({ event, resolve }) => {
	const start = Date.now();
	const path = event.url.pathname;

	// 0-a) メンテナンスモード（Lambda環境変数で切替）
	if (MAINTENANCE_MODE && path !== '/api/health') {
		return new Response(JSON.stringify({ status: 'maintenance', message: 'メンテナンス中です' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json', 'Retry-After': '600' },
		});
	}

	// 0-b) レートリミット（cognito 本番モードのみ、dev モードは除外）
	if (
		authMode === 'cognito' &&
		!COGNITO_DEV_MODE &&
		!path.startsWith('/_app/') &&
		!path.startsWith('/favicon')
	) {
		const ip = event.getClientAddress();
		const isAuthRoute = path.startsWith('/auth/');
		const { allowed, remaining, resetAt } = isAuthRoute
			? checkAuthRateLimit(ip)
			: checkApiRateLimit(ip);

		if (!allowed) {
			logger.warn(`Rate limit exceeded: ${ip} on ${path}`);
			const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
			return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': String(retryAfter),
				},
			});
		}
		event.request.headers.set('X-RateLimit-Remaining', String(remaining));
	}

	// 1) 二層セッション解決
	// デモモード: /demo 以下は認証不要、ダミーコンテキストをセット
	if (path.startsWith('/demo')) {
		event.locals.authenticated = false;
		event.locals.identity = null;
		event.locals.context = {
			tenantId: 'demo',
			role: 'owner',
			licenseStatus: 'active',
		};
		const response = await resolve(event);
		if (!path.startsWith('/_app/') && !path.startsWith('/favicon')) {
			logger.request(event.request.method, path, response.status, Date.now() - start);
		}
		return response;
	}

	const identity = await provider.resolveIdentity(event);
	const context = await provider.resolveContext(event, identity);

	event.locals.authenticated = identity !== null;
	event.locals.identity = identity;
	event.locals.context = context;

	// 2) ルート保護

	// セットアップチェック（local モードのみ — 子供が未登録ならセットアップへ）
	if (authMode === 'local') {
		const tenantId = context?.tenantId ?? 'local';
		if (
			!path.startsWith('/setup') &&
			!path.startsWith('/_app') &&
			!path.startsWith('/favicon') &&
			!path.startsWith('/api/health')
		) {
			if (await isSetupRequired(tenantId)) {
				redirect(302, '/setup');
			}
		}

		// セットアップ完了済みなら /setup へのアクセスをブロック
		if (path.startsWith('/setup') && !(await isSetupRequired(tenantId))) {
			redirect(302, '/');
		}
	}

	// cognito モードで旧 /login（PIN画面）にアクセスした場合 → /auth/login へ
	if (authMode === 'cognito' && path === '/login') {
		redirect(302, '/auth/login');
	}

	// 認可チェック（Provider 固有のルート保護）
	const authResult = provider.authorize(path, identity, context);
	if (!authResult.allowed) {
		redirect(302, authResult.redirect);
	}

	const response = await resolve(event);

	// 3) セキュリティヘッダ付与
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (authMode === 'cognito') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	// 認証必要ページはブラウザキャッシュ禁止（ログアウト後の戻るボタン対策）
	if (path.startsWith('/admin') || path === '/login' || path.startsWith('/auth/')) {
		response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
		response.headers.set('Pragma', 'no-cache');
		response.headers.set('Expires', '0');
	}

	// 4) リクエストログ（静的ファイルは除外）
	if (!path.startsWith('/_app/') && !path.startsWith('/favicon')) {
		logger.request(event.request.method, path, response.status, Date.now() - start);
	}

	return response;
};

// サーバーエラーハンドラ: 500エラーの詳細をログに記録 + Discord 障害通知
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

	// 500 系エラーのみ Discord に通知（4xx は通常エラーなので除外）
	if (status >= 500) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		notifyIncident(errorMsg, { method, path, status }).catch(() => {});
	}

	return { message: 'Internal Server Error' };
};
