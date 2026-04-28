import { randomUUID } from 'node:crypto';
import { type Handle, type HandleServerError, json, redirect } from '@sveltejs/kit';
import { building } from '$app/environment';
import { analytics } from '$lib/analytics';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { can } from '$lib/policy/capabilities';
import { env } from '$lib/runtime/env';
import { buildEvaluationContext, setEvaluationContext } from '$lib/runtime/evaluation-context';
import { type RuntimeMode, resolveRuntimeMode } from '$lib/runtime/runtime-mode';
import { getAuthMode, getAuthProvider } from '$lib/server/auth/factory';
import { applyDebugPlanOverride, getDebugLicenseKeyOverride } from '$lib/server/debug-plan';
import {
	DEMO_MODE_COOKIE,
	DEMO_MODE_COOKIE_MAX_AGE,
	DEMO_WRITE_ALLOWLIST,
	DEMO_WRITE_METHODS,
	resolveDemoActive,
} from '$lib/server/demo/demo-mode';
import {
	applyDemoPlanToContext,
	DEMO_PLAN_COOKIE,
	isDemoPlan,
	resolveDemoPlan,
} from '$lib/server/demo/demo-plan';
import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';
import { runWithRequestContext } from '$lib/server/request-context';
import { findLegacyRedirect, rewriteLegacyPath } from '$lib/server/routing/legacy-url-map';
import { checkApiRateLimit, checkAuthRateLimit } from '$lib/server/security/rate-limiter';
import { trackServerError } from '$lib/server/services/analytics-service';
import { checkConsent } from '$lib/server/services/consent-service';
import { notifyIncident } from '$lib/server/services/discord-notify-service';
import { touchTenantLastActive } from '$lib/server/services/last-active-touch';
import { assertLicenseKeyConfigured } from '$lib/server/services/license-key-service';
import { isSetupRequired } from '$lib/server/services/setup-service';

// #806: production で AWS_LICENSE_SECRET が未設定だと署名付きキーの偽造が可能になる。
// モジュールロード時に明示的に失敗させることで、誤デプロイを早期検知する。
// `building` は vite build / prerender 中のみ true。ビルド時は env が無くても通す。
if (!building) {
	assertLicenseKeyConfigured();
}

/**
 * Accept ヘッダーを検査し、ブラウザ（HTML）リクエストかどうかを判定する
 */
function acceptsHtml(request: Request): boolean {
	const accept = request.headers.get('Accept') ?? '';
	return accept.includes('text/html');
}

/**
 * ミニマルなスタイル付き HTML エラーページを生成する
 * (hooks 内で SvelteKit のレンダリングパイプラインを通らない場面用)
 */
function renderErrorHtml(status: number, title: string, message: string): string {
	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} - がんばりクエスト</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f2f9ff;color:#2d2d2d}
.container{text-align:center;padding:2rem;max-width:480px}
.status{font-size:4rem;font-weight:700;color:#4a90d9;margin-bottom:0.5rem}
h1{font-size:1.25rem;margin:0 0 1rem}
p{color:#8b8b8b;line-height:1.6}
a{color:#4a90d9;text-decoration:none;font-weight:500}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="container">
<div class="status">${status}</div>
<h1>${title}</h1>
<p>${message}</p>
<p style="margin-top:2rem"><a href="/">トップページへ戻る</a></p>
</div>
</body>
</html>`;
}

const provider = getAuthProvider();

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const COGNITO_DEV_MODE = process.env.COGNITO_DEV_MODE === 'true';

/**
 * ADR-0040 P4 (#1217): Policy Gate `can(ctx, 'write.db')` 経由で "demo 書き込み no-op"
 * を判定する参考実装。hooks main handler の cognitive complexity を上げないために、
 * 判定をここへ切り出している。true を返したら呼び側で 200 `{ ok: true, demo: true }`
 * を返す。他の write 拒否理由 (build-time-readonly / license-key-invalid) は
 * 本ブロックではなく P4.1 以降で個別ガードに置き換える想定。
 */
function shouldReturnDemoNoop(method: string, path: string, mode: RuntimeMode): boolean {
	if (!DEMO_WRITE_METHODS.has(method)) return false;
	const writeResult = can(buildEvaluationContext({ mode }), 'write.db');
	if (writeResult.allowed || writeResult.reason !== 'demo-readonly') return false;
	return (
		!DEMO_WRITE_ALLOWLIST.some((prefix) => path.startsWith(prefix)) && !path.startsWith('/_app/')
	);
}

/**
 * ADR-0040 P5 (#1221): EvaluationContext ビルダのラッパー。
 *
 * nuc-prod モードで `DEBUG_LICENSE_KEY_VALID` env が立っていれば licenseKey を注入する。
 * Playwright matrix (`playwright.matrix.config.ts`) で license valid/invalid を
 * 切り替えるための dev-only フック。本番ビルドでは `getDebugLicenseKeyOverride()` が
 * 常に null を返すため常に従来通りの動作になる。
 */
function resolveEvaluationContextForRequest(mode: RuntimeMode) {
	const debugLicense = mode === 'nuc-prod' ? getDebugLicenseKeyOverride() : null;
	return buildEvaluationContext({
		mode,
		licenseKey: debugLicense ? { valid: debugLicense.valid, expiresAt: null } : null,
	});
}

// Initialize analytics providers (lazy, environment-variable gated)
analytics.init();

/**
 * Build CSP header.
 *
 * #1591 (ADR-0023 I2): umami / Sentry プロバイダ削除に伴い、provider 固有ドメインの
 * 追加は不要になった。analytics は AWS 内完結 (DynamoDB) のため connectSrc / scriptSrc
 * に外部ホストを足す必要がない — 'self' で完結する。これにより CSP は静的に決まり、
 * 「外部送信ゼロ」が CSP レイヤでも構造的に保証される。
 */
function buildCspHeader(): string {
	return [
		`default-src 'self'`,
		`script-src 'self' 'unsafe-inline'`,
		`style-src 'self' 'unsafe-inline'`,
		`img-src 'self' data: blob:`,
		`media-src 'self' blob:`,
		`font-src 'self'`,
		`connect-src 'self'`,
		`object-src 'none'`,
		`base-uri 'self'`,
		`frame-ancestors 'none'`,
	].join('; ');
}

/** Cached CSP header (built once at startup) */
const CSP_HEADER = buildCspHeader();

export const handle: Handle = ({ event, resolve }) =>
	// #788: リクエスト境界でコンテキストを張る。resolveFullPlanTier / getTrialStatus が
	// このリクエスト内で初回呼び出し時に DB を叩き、以降は memoize された値を返す。
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
	runWithRequestContext(async () => {
		const start = Date.now();
		const path = event.url.pathname;
		const authMode = getAuthMode();

		// リクエストID 生成（相関ID）
		event.locals.requestId = randomUUID();

		// 0-a) メンテナンスモード（Lambda環境変数で切替）
		if (MAINTENANCE_MODE && path !== '/api/health') {
			if (acceptsHtml(event.request)) {
				return new Response(
					renderErrorHtml(
						503,
						'メンテナンス中',
						'ただいまメンテナンス中です。しばらくしてから再度お試しください。',
					),
					{
						status: 503,
						headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '600' },
					},
				);
			}
			return new Response(
				JSON.stringify({ status: 'maintenance', message: 'メンテナンス中です' }),
				{
					status: 503,
					headers: { 'Content-Type': 'application/json', 'Retry-After': '600' },
				},
			);
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
				? checkAuthRateLimit(ip, event.request.method)
				: checkApiRateLimit(ip);

			if (!allowed) {
				logger.warn(`Rate limit exceeded: ${ip} on ${path}`);
				const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
				if (acceptsHtml(event.request)) {
					return new Response(
						renderErrorHtml(
							429,
							'アクセスが集中しています',
							'アクセスが集中しています。しばらくしてから再度お試しください。',
						),
						{
							status: 429,
							headers: {
								'Content-Type': 'text/html; charset=utf-8',
								'Retry-After': String(retryAfter),
							},
						},
					);
				}
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

		// 0-c) 旧 URL の中央リダイレクト（#578）
		//
		// 年齢区分リネーム等で廃止された URL は `legacy-url-map.ts` に集約されている。
		// ここで一括処理することで、個別ルートに散在していた 404 救済ロジックを
		// 不要にする。クエリ文字列・ハッシュは保持される。
		//
		// 認証・セッション解決より前に実行するため、ログイン状態に関係なく
		// 全ユーザーに対してリダイレクトが効く。
		const legacyEntry = findLegacyRedirect(path);
		if (legacyEntry) {
			const newPath = rewriteLegacyPath(path, legacyEntry);
			const newUrl = newPath + event.url.search + event.url.hash;
			logger.info(`Legacy URL redirect: ${path} → ${newPath} (${legacyEntry.issue})`, {
				requestId: event.locals.requestId,
				path,
				context: {
					from: path,
					to: newPath,
					issue: legacyEntry.issue,
				},
			});
			redirect(legacyEntry.status ?? 308, newUrl);
		}

		// 1) デモ実行モード判定（ADR-0039 / #1180）
		//
		// `?mode=demo` クエリ → cookie `gq_demo=1` → `/demo/*` パス（Phase 1 backward compat）
		// の順でデモ状態を解決。event.locals.isDemo を server-side SSOT として設定する。
		// 本番ルートツリー上で同一コードパスを流すことで、
		// `src/routes/demo/**` 別ツリー起因の乖離 (#296/#1129/#1147/#1180) を構造解消する。
		// Phase 2 で /demo/* が削除されたら `fromLegacyPath` 経路も除去する。
		//
		// prerender 中は SvelteKit が url.searchParams へのアクセスを禁ずる
		// （deterministic でなくなるため）。building 時はデモ判定をスキップして
		// false 固定にする — 静的ページは常に非デモ状態で生成される。
		if (building) {
			event.locals.isDemo = false;
		} else {
			const modeQuery = event.url.searchParams.get('mode');
			const demoCookie = event.cookies.get(DEMO_MODE_COOKIE);
			const {
				isDemo: demoActive,
				fromQuery: demoFromQuery,
				fromLegacyPath: demoFromLegacyPath,
			} = resolveDemoActive(modeQuery, demoCookie, path);

			// cookie 未設定でデモ入口を踏んだ場合のみ発行する（毎リクエスト発行しない）。
			const shouldIssueCookie =
				(demoFromQuery || demoFromLegacyPath) && demoCookie !== '1' && !path.startsWith('/_app/');
			if (shouldIssueCookie) {
				event.cookies.set(DEMO_MODE_COOKIE, '1', {
					path: '/',
					sameSite: 'lax',
					httpOnly: true,
					maxAge: DEMO_MODE_COOKIE_MAX_AGE,
				});
			}

			event.locals.isDemo = demoActive;
		}

		// ADR-0040 P2: 実行モードをリクエスト単位で解決。以降のガード／UI 出力は
		// 本モードを起点に判断する想定（P4 で capability gate に昇格予定）。
		// isDemo 解決より後に呼ぶことで、`?mode=demo` / cookie / `/demo/*` すべて
		// を 'demo' に正しく落とし込む。
		event.locals.runtimeMode = resolveRuntimeMode({
			env,
			pathname: path,
			isBuilding: building,
			isDemoRequest: event.locals.isDemo,
		});

		// 2) デモ入口/退出ルート
		// /demo/exit: cookie を消して本番に戻す
		if (path === '/demo/exit') {
			event.cookies.delete(DEMO_MODE_COOKIE, { path: '/' });
			event.cookies.delete(DEMO_PLAN_COOKIE, { path: '/' });
			redirect(302, '/');
		}

		// 3) デモ状態なら書き込みを 200 no-op で抑止
		//
		// UI 側の form actions / fetch は「成功した」と認識して正常に
		// リダイレクト・再描画するので、子供向け UX にエラーが出ない。
		// 実際の DB・外部 API は呼ばれないので副作用なし（Stripe test mode と同じ設計）。
		//
		// ADR-0040 P4 (#1217): 判定は `shouldReturnDemoNoop` に切り出し Policy Gate
		// `can(ctx, 'write.db')` 経由で評価する。`demo-readonly` 理由のみ no-op にし、
		// 他の write 拒否理由 (build-time-readonly / license-key-invalid) は P4.1 以降
		// で個別ガードに置き換える。
		if (shouldReturnDemoNoop(event.request.method, path, event.locals.runtimeMode)) {
			logger.info(`Demo write no-op: ${event.request.method} ${path}`, {
				requestId: event.locals.requestId,
				path,
			});
			return json({ ok: true, demo: true });
		}

		// 4) デモ時はダミー context を合成（本番ルートをそのまま駆動する）
		if (event.locals.isDemo) {
			event.locals.authenticated = false;
			event.locals.identity = null;

			// #760: ?plan= クエリ → cookie の優先順でデモプランを決定し、cookie に永続化する。
			const planQuery = event.url.searchParams.get('plan');
			const planCookie = event.cookies.get(DEMO_PLAN_COOKIE);
			const demoPlan = resolveDemoPlan(planQuery, planCookie);
			if (isDemoPlan(planQuery) && planQuery !== planCookie) {
				event.cookies.set(DEMO_PLAN_COOKIE, demoPlan, {
					path: '/',
					sameSite: 'lax',
					httpOnly: true,
					maxAge: 60 * 60 * 24 * 30, // 30 日
				});
			}

			const baseDemoContext = applyDemoPlanToContext(
				{
					tenantId: 'demo',
					role: 'owner',
					licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
				},
				demoPlan,
			);
			event.locals.context = applyDebugPlanOverride(baseDemoContext);

			// ADR-0040 P3 (#1215): デモ実行時の EvaluationContext を注入。
			// demo は非認証のため user / plan / licenseKey は null。
			// mode='demo' により P4 Policy Gate で write 系 capability が deny される。
			setEvaluationContext(
				buildEvaluationContext({
					mode: event.locals.runtimeMode,
				}),
			);

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
		const resolvedContext = await provider.resolveContext(event, identity);
		// DEBUG_PLAN / DEBUG_TRIAL による上書きは、以降の認可・tenantStatus チェックにも
		// 一貫して適用する必要があるため、ローカル変数 context 自体を上書き後の値で統一する。
		const context = applyDebugPlanOverride(resolvedContext);

		event.locals.authenticated = identity !== null;
		event.locals.identity = identity;
		event.locals.context = context;

		// #1601 (ADR-0023 §5 I11): 認証成功時に Tenant.lastActiveAt を touch する。
		// 1 日 1 回のガードは touchTenantLastActive 内の in-memory cache で吸収。
		// 失敗しても主処理は止めない (await はするがエラーは内部で握りつぶす)。
		if (identity && context?.tenantId) {
			await touchTenantLastActive(context.tenantId);
		}

		// ADR-0040 P3 (#1215): 認証解決完了後の EvaluationContext を注入。
		// P3 スコープでは mode のみ真面目に投影し、user / plan / licenseKey の詳細投影は
		// P4 で capability 判定が必要になった時点で追加する（resolvePlanTier の I/O を
		// hooks で先取りしないため）。既存の event.locals.* は互換のため変更しない。
		setEvaluationContext(resolveEvaluationContextForRequest(event.locals.runtimeMode));

		// 2) ルート保護

		// セットアップチェック（local モードのみ — 子供が未登録ならセットアップへ）
		if (authMode === 'local') {
			const tenantId = context?.tenantId ?? 'local';
			if (
				!path.startsWith('/setup') &&
				!path.startsWith('/_app') &&
				!path.startsWith('/favicon') &&
				!path.startsWith('/api/health') &&
				// #832: 公開 SEO エンドポイントはセットアップ前でもクロール可能にする。
				// プリレンダも hooks.server を通るため、除外しないと /setup へ 302 され
				// sitemap.xml がビルド時に生成できずビルド失敗する。
				path !== '/sitemap.xml' &&
				path !== '/robots.txt' &&
				// #1601: 配信停止リンクは未認証 + セットアップ前でもアクセス可能にする
				// （特定電子メール法準拠: クリックしたら確実に解除できる必要がある）。
				!path.startsWith('/unsubscribe/') &&
				// #1594 ADR-0023 I8: founder 直接相談動線は公開ページ（未認証 / セットアップ前でもアクセス可）
				!path.startsWith('/inquiry/founder') &&
				!path.startsWith('/api/v1/inquiry/founder') &&
				// #1598 ADR-0023 I7: PMF 判定アンケート (Sean Ellis Test) は HMAC トークン認証で
				// メールリンクから直接アクセスする。セットアップ前でもアクセス可能にする。
				!path.startsWith('/survey/')
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
			if (path.startsWith('/api/')) {
				const status = authResult.status ?? 401;
				return new Response(
					JSON.stringify({
						error: status === 403 ? 'アクセスが拒否されました' : '認証が必要です',
					}),
					{ status, headers: { 'Content-Type': 'application/json' } },
				);
			}
			redirect(302, authResult.redirect);
		}

		// grace_period 読み取り専用制御（#0193）
		if (context?.tenantStatus === SUBSCRIPTION_STATUS.GRACE_PERIOD) {
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
		if (context?.tenantStatus === SUBSCRIPTION_STATUS.TERMINATED) {
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
		response.headers.set('Content-Security-Policy', CSP_HEADER);
		if (authMode === 'cognito') {
			response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
		}

		// 認証必要ページはブラウザキャッシュ禁止（ログアウト後の戻るボタン対策）
		if (path.startsWith('/admin') || path === '/login' || path.startsWith('/auth/')) {
			response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
			response.headers.set('Pragma', 'no-cache');
			response.headers.set('Expires', '0');
		}

		// 4) リクエストログ + アナリティクス（静的ファイルは除外）
		if (!path.startsWith('/_app/') && !path.startsWith('/favicon')) {
			logger.request(event.request.method, path, response.status, Date.now() - start, {
				requestId: event.locals.requestId,
				tenantId: context?.tenantId,
			});

			// 4-a) 404 構造化ログ（#577）
			//
			// HTML リクエストの 404 のみを拾い、集計・棚卸しできるようにする。
			// LEGACY_URL_MAP にヒットしたパスはこの時点で既にリダイレクト済みなので、
			// ここに来る 404 は「マップ未登録の旧 URL」「タイポ」「外部リンク切れ」の
			// いずれか。referer / userAgent / role を出力することで原因を分類する。
			if (response.status === 404 && event.request.method === 'GET' && acceptsHtml(event.request)) {
				logger.warn(`404 Not Found: ${path}`, {
					requestId: event.locals.requestId,
					tenantId: context?.tenantId,
					path,
					status: 404,
					context: {
						referer: event.request.headers.get('Referer') ?? null,
						userAgent: event.request.headers.get('User-Agent') ?? null,
						role: context?.role ?? 'anonymous',
					},
				});
			}

			// Analytics: identify tenant and track page views for HTML requests
			if (context?.tenantId) {
				analytics.identify(context.tenantId);
			}
			if (event.request.method === 'GET' && acceptsHtml(event.request)) {
				analytics.trackPageView(path, event.request.headers.get('Referer') ?? undefined);
			}
		}

		return response;
	});

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

	// Analytics: track all server errors
	if (error instanceof Error) {
		trackServerError(error, { method, path, status, requestId, tenantId });
	}

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

	// ステータスコードに応じたメッセージを返す
	if (status === 404) {
		return { message: 'ページが見つかりません' };
	}
	if (status === 429) {
		return { message: 'アクセスが集中しています' };
	}
	if (status === 403) {
		return { message: 'アクセスが拒否されました' };
	}
	// その他の 4xx はSvelteKitが設定した元のメッセージをそのまま返す
	if (status < 500) {
		return { message };
	}
	return { message: 'サーバーエラーが発生しました' };
};
