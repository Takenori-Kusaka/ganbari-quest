import { randomUUID } from 'node:crypto';
import { getAuthMode, getAuthProvider } from '$lib/server/auth/factory';
import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';
import { checkApiRateLimit, checkAuthRateLimit } from '$lib/server/security/rate-limiter';
import { checkConsent } from '$lib/server/services/consent-service';
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

	// リクエストID 生成（相関ID）
	event.locals.requestId = randomUUID();

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
			logger.request(event.request.method, path, response.status, Date.now() - start, {
				requestId: event.locals.requestId,
				tenantId: 'demo',
			});
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

	// grace_period 読み取り専用制御（#0193）
	if (context?.tenantStatus === 'grace_period') {
		const method = event.request.method;
		const isWrite = method !== 'GET' && method !== 'HEAD';
		const isAllowedWritePath = [
			'/api/v1/admin/tenant/reactivate',
			'/api/v1/export',
			'/api/v1/auth/logout',
			'/auth/logout',
		].some((p) => path.startsWith(p));

		if (isWrite && !isAllowedWritePath) {
			if (path.startsWith('/api/')) {
				return new Response(
					JSON.stringify({ error: 'テナントは解約手続き中です。読み取り専用モードです。' }),
					{ status: 403, headers: { 'Content-Type': 'application/json' } },
				);
			}
			// フォーム送信等は設定画面にリダイレクト
			redirect(302, '/admin/settings?reason=grace_period');
		}
	}

	// terminated テナントは完全ブロック（#0193）
	if (context?.tenantStatus === 'terminated') {
		if (path.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'アカウントは削除済みです。' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		redirect(302, '/auth/login?reason=deleted');
	}

	// 同意バージョンチェック（cognito 本番モードのみ、dev モードは除外）
	if (
		authMode === 'cognito' &&
		!COGNITO_DEV_MODE &&
		identity &&
		context?.tenantId &&
		!path.startsWith('/consent') &&
		!path.startsWith('/legal/') &&
		!path.startsWith('/auth/') &&
		!path.startsWith('/api/') &&
		!path.startsWith('/_app/') &&
		!path.startsWith('/favicon')
	) {
		const consent = await checkConsent(context.tenantId);
		if (consent.needsReconsent) {
			redirect(302, '/consent');
		}
	}

	const response = await resolve(event);

	// 3) セキュリティヘッダ付与
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	response.headers.set(
		'Content-Security-Policy',
		"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
	);
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
		logger.request(event.request.method, path, response.status, Date.now() - start, {
			requestId: event.locals.requestId,
			tenantId: context?.tenantId,
		});
	}

	return response;
};

// サーバーエラーハンドラ: 500エラーの詳細をログに記録 + Discord 障害通知
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const method = event.request.method;
	const path = event.url.pathname;
	const requestId = event.locals.requestId ?? 'unknown';
	const tenantId = event.locals.context?.tenantId;
	const stack = error instanceof Error ? error.stack : undefined;

	logger.error(`[${status}] ${method} ${path}: ${message}`, {
		method,
		path,
		status,
		requestId,
		tenantId,
		error: error instanceof Error ? error.message : String(error),
		stack,
	});

	// 500 系エラーのみ Discord に通知（4xx は通常エラーなので除外）
	if (status >= 500) {
		const errorMsg = error instanceof Error ? error.message : String(error);

		// 既存の通知サービス（互換維持）
		notifyIncident(errorMsg, { method, path, status }).catch(() => {});

		// 新アラートシステム（スロットリング付き、requestId/tenantId 含む）
		sendDiscordAlert({
			level: 'error',
			message: 'Internal Server Error',
			method,
			path,
			status,
			requestId,
			tenantId,
			errorSummary: errorMsg,
			stackSummary: stack?.split('\n').slice(0, 3).join('\n'),
		}).catch(() => {});
	}

	return { message: 'Internal Server Error' };
};
