import { randomUUID } from 'node:crypto';
import {
	type Handle,
	type HandleServerError,
	json,
	type RequestEvent,
	redirect,
} from '@sveltejs/kit';
import { building } from '$app/environment';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { can } from '$lib/policy/capabilities';
import { env } from '$lib/runtime/env';
import { buildEvaluationContext, setEvaluationContext } from '$lib/runtime/evaluation-context';
import { type RuntimeMode, resolveRuntimeMode } from '$lib/runtime/runtime-mode';
import { getAuthMode, getAuthProvider } from '$lib/server/auth/factory';
import { TenantEntitlementUnavailableError } from '$lib/server/auth/tenant-entitlement';
import type { AuthContext } from '$lib/server/auth/types';
import { cronJobNameFromPath, recordCronRun } from '$lib/server/cron/cron-heartbeat';
import { getOrInitDb } from '$lib/server/db/client';
// #3620 AC-C2: DATA_SOURCE=pglite の非同期 init guard 用 (import は side-effect free、
// PGlite instance は initPgliteConnection() 呼び出し時のみ生成)。
import { initPgliteConnection } from '$lib/server/db/pglite/connection';
import { applyDebugPlanOverride } from '$lib/server/debug-plan';
import {
	buildDemoNoopResponseBody,
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
import { evaluateFrontDoor, ORIGIN_VERIFY_HEADER } from '$lib/server/security/origin-verify';
import { checkApiRateLimit, checkAuthRateLimit } from '$lib/server/security/rate-limiter';
import { checkConsent } from '$lib/server/services/consent-service';
import { notifyIncident } from '$lib/server/services/discord-notify-service';
import { getGracePeriodStatus } from '$lib/server/services/grace-period-service';
import { touchTenantLastActive } from '$lib/server/services/last-active-touch';
import { applyOperatorPinResetIfRequested } from '$lib/server/services/pin-operator-reset';
import { isSetupRequired } from '$lib/server/services/setup-service';

// Epic #2525 Phase 7 Step 0 PR-L0 (#2806): license key 完全全廃 (#2788) の expand 起点。
// 旧来の `assertLicenseKeyConfigured()` 起動時呼び出し (AWS_LICENSE_SECRET 未設定時に
// production で throw) を撤去し、起動不能リスクを消滅させる (throw 源除去)。
// license key は Stripe subscription = entitlement SSOT への移行に伴い冗長層であり、
// 撤去で振る舞いは不変。`license-key-service.ts` の関数本体は PR-L3 (#2818) で物理削除済。

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

/**
 * #3963 (PO 決裁 2026-07-29): 課金状態の解決失敗 (fail-closed 503) から除外する probe パス。
 *
 * health / readiness は「アプリのプロセスが生きているか」を問う外形監視であり、課金状態に
 * 一切依存しない。ここを 503 にすると、DSQL 障害時に Lambda health / LWA readiness /
 * `deploy-aws-staging.yml` の post-deploy health / ロールバック判定がまとめて誤作動し、
 * 「DB が一時的に不調」だけの状況が「デプロイ失敗 / アプリ死亡」として扱われる。
 *
 * 実運用の probe は未認証 (identity=null) で `resolveContext` の DB 経路に入らないが、
 * それは probe の呼ばれ方に依存した暗黙の前提でしかない (認証 Cookie を持つブラウザや
 * 将来の認証付き probe で崩れる)。前提に頼らず path で明示除外する。
 */
const ENTITLEMENT_FAILURE_EXEMPT_PATHS = ['/api/health', '/api/ready'] as const;

function isEntitlementFailureExemptPath(path: string): boolean {
	return ENTITLEMENT_FAILURE_EXEMPT_PATHS.some(
		(exempt) => path === exempt || path.startsWith(`${exempt}/`),
	);
}

/**
 * #3963: 課金状態を DB から解決できず context を発行できなかった場合の応答。
 *
 * fail-closed の副作用として、認証は生きているのに context だけが無い状態が生じる。
 * これをログイン画面へのリダイレクトで表現すると「ログアウトさせられた」と誤解される
 * ため、一時的な障害であることが読み取れる 503 を返す。
 *
 * 併せて alert kind `auth-entitlement-db-unavailable` で観測可能にする。
 * 「DB 障害で剥奪」と「正当に無権限」が同じ見え方だと incident の切り分けができない
 * (#3968 の `stripe-plan-unresolved` と同じ発想)。
 */
function respondEntitlementUnavailable(
	event: RequestEvent,
	error: TenantEntitlementUnavailableError,
): Response {
	const kind = TenantEntitlementUnavailableError.ALERT_KIND;
	logger.error(`[auth-alert] ${kind}: 課金状態を DB から解決できず context を発行しませんでした`, {
		requestId: event.locals.requestId,
		tenantId: error.tenantId,
		context: {
			kind,
			path: event.url.pathname,
			errorSummary: error.dbError instanceof Error ? error.dbError.message : String(error.dbError),
		},
	});

	// fire-and-forget (alert 失敗でリクエスト処理をブロックしない)
	void sendDiscordAlert({
		level: 'critical',
		message: `[${kind}] 課金状態を DB から解決できず全リクエストが 503 になっています`,
		path: event.url.pathname,
		method: event.request.method,
		status: 503,
		requestId: event.locals.requestId,
		// #4192: tenantId は Discord に載せない (#4174 Q3)。上の logger.error が requestId と
		// 対で残しているので、認証された場所 (CloudWatch Logs) から引く。
		errorSummary: kind,
	}).catch(() => {
		// recursive alert を避けるため握り潰す (上の logger.error で観測は担保済み)
	});

	if (acceptsHtml(event.request)) {
		return new Response(
			renderErrorHtml(
				503,
				'一時的にご利用いただけません',
				'システムが一時的に混み合っています。ログアウトはされていませんので、しばらくしてから再度お試しください。',
			),
			{
				status: 503,
				headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '30' },
			},
		);
	}
	return new Response(
		JSON.stringify({
			error: 'システムが一時的に混み合っています。しばらくしてから再度お試しください。',
			kind,
		}),
		{
			status: 503,
			headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
		},
	);
}

const provider = getAuthProvider();

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const COGNITO_DEV_MODE = process.env.COGNITO_DEV_MODE === 'true';

/**
 * #4280 案 b: front door (CloudFront) 検査が secret 未設定で無効なことを、プロセスで 1 回だけ
 * log するためのフラグ。「黙って無防備」を作らないための可視化であり、毎リクエスト出すと
 * NUC / ローカル (CloudFront を持たない正当な配備) でログが埋まるため 1 回に絞る。
 */
let frontDoorDisabledLogged = false;

/**
 * #4364: 旧 secret を並行受理中 (= ローテーション途中) であることを、プロセスで 1 回だけ
 * log するためのフラグ。旧値に TTL は無く、runbook 段 3 を忘れると漏れた旧値が無期限に
 * 有効なままになるため、残置を CloudWatch から観測できるようにする。
 */
let frontDoorRotationLogged = false;

/**
 * #4280 案 b: front door 検査。CloudFront を経由しない `/admin` `/api/v1/admin` `/ops` への
 * 到達 (Lambda Function URL 直叩き) を拒否する。
 *
 * 拒否時は **404** を返す (403 ではない)。403 は「そこに何かがある」ことを教えるが、
 * この経路に来る呼び出しは定義上まっとうなブラウザではない (実利用者は必ず CloudFront を
 * 通る) ため、存在自体を伏せる側に倒す。代わりに**サーバ側 log には残す** —
 * 呼び出し元に情報を与えず、運営者は CloudWatch で即座に切り分けられる。
 *
 * log には path / method / 判定コードのみを載せる。secret・header 値・IP・顧客識別子は載せない。
 *
 * @returns 拒否する場合は Response、通す場合は null
 */
function checkFrontDoor(event: RequestEvent, path: string): Response | null {
	// ローテーション中 (旧値を並行受理している状態) を観測可能にする (#4364)。
	//
	// 旧値には TTL が無いため、runbook の段 3 (旧値を空にして deploy) を実行し忘れると
	// **漏れた旧値が無期限に受理され続け、ローテーションの目的が黙って無効化される**。
	// GitHub Secret の中身は CI からも本番からも検査できないので、せめて
	// 「今この Lambda は 2 値を受理している」ことを log に 1 回残し、CloudWatch で
	// 残置に気付けるようにする (log が出続けている = 段 3 が未実施)。
	if (env.ORIGIN_VERIFY_SECRET_PREVIOUS && !frontDoorRotationLogged) {
		frontDoorRotationLogged = true;
		logger.warn(
			'[front-door] ORIGIN_VERIFY_SECRET_PREVIOUS が設定されています = 旧 secret を並行受理中 ' +
				'(ローテーション途中の正常状態)。伝播完了後は旧値を空にして deploy し直してください。' +
				'放置すると漏れた旧値が無期限に有効なままになります ' +
				'(手順: docs/runbooks/origin-verify-secret-rotation.md 段 3、#4364)',
		);
	}

	const decision = evaluateFrontDoor(
		path,
		event.request.headers.get(ORIGIN_VERIFY_HEADER),
		env.ORIGIN_VERIFY_SECRET,
		// ローテーション中の 1 世代前の値 (#4364)。定常状態では未設定 = 新値のみで判定。
		env.ORIGIN_VERIFY_SECRET_PREVIOUS,
	);

	if (decision === 'not-configured') {
		if (!frontDoorDisabledLogged) {
			frontDoorDisabledLogged = true;
			logger.info(
				'[front-door] ORIGIN_VERIFY_SECRET 未設定のため CloudFront 経由検査は無効です ' +
					'(CloudFront を持たない配備 = NUC / ローカル / demo では正常。AWS 本番・staging では ' +
					'CDK synth と deploy.yml の必須 secret 検証が未設定を止めます、#4280)',
			);
		}
		return null;
	}
	if (decision === 'allow') return null;

	logger.warn('[front-door] blocked non-CloudFront request to protected path', {
		requestId: event.locals.requestId,
		path,
		context: { code: 'front_door_missing_header', method: event.request.method },
	});

	if (acceptsHtml(event.request)) {
		return new Response(
			renderErrorHtml(404, 'ページが見つかりません', 'お探しのページは見つかりませんでした。'),
			{ status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
		);
	}
	return new Response(JSON.stringify({ error: 'Not Found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * ADR-0040 P4 (#1217): Policy Gate `can(ctx, 'write.db')` 経由で "demo 書き込み no-op"
 * を判定する参考実装。hooks main handler の cognitive complexity を上げないために、
 * 判定をここへ切り出している。true を返したら呼び側で 200 `{ ok: true, demo: true }`
 * を返す。他の write 拒否理由 (build-time-readonly) は
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
 * 退会 (アカウント削除) 申請済みか。#3993 の読み取り専用ロックの判定に使う。
 *
 * **判定できないときは通す (fail-open)。** ロックの目的は「退会申請中の家庭が
 * データを増やし続けるのを防ぐ」ことであり、settings が読めない瞬間に書き込みを
 * 止めると、**DB 障害が「子どもが記録できない」という顧客影響に化ける**。
 * ここは #3963 の entitlement (課金権限) とは逆で、fail-open が安全側になる。
 */
async function isTenantSoftDeleted(tenantId: string): Promise<boolean> {
	try {
		return (await getGracePeriodStatus(tenantId)).isSoftDeleted;
	} catch (err) {
		logger.warn('[hooks] 退会申請状態を判定できませんでした (書き込みは許可)', {
			context: { tenantId },
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}

// #3829 (EPIC #3408 slice C): アプリ側 CSP は SvelteKit 標準 CSP (svelte.config.js kit.csp、
// hash mode) に一本化した。SvelteKit が hydration bootstrap の inline script を sha256 hash 化して
// `script-src` に自動注入するため `script-src 'unsafe-inline'` を撤廃できる (stored-XSS の script
// ベクタ最終防壁化、#3112 構造リスク 1)。旧 `buildCspHeader()` / `CSP_HEADER` / 下記
// `response.headers.set('Content-Security-Policy', ...)` は clobber (二重付与) を避けるため撤去済。
// directive 値の SSOT は svelte.config.js kit.csp。「外部送信ゼロ」の connect-src 'self' 固定も
// 同 config に引き継いでいる (ADR-0067 / ADR-0023 §3.4)。
// clickjacking 防御 (下記 `X-Frame-Options: DENY`) は resolve(event) を通る SSR / 動的レスポンス
// 全てに付与される。対話 HTML ページは全て SSR のため確実に効く。prerender ページ (唯一 sitemap.xml、
// 非対話 XML) は build 時に静的化され hooks を経由しないため X-Frame-Options を持たないが、iframe 埋込
// による clickjacking の実害は無い (QM runtime 検証 #3833 で実挙動を確認)。

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

		// #2648 Phase A Round 12 (Option γ-extended): 1st-request DB init guard。
		// `client.ts` は lazy DB init pattern を採用しており、`new Database(DATABASE_URL)` は
		// module load 時でなく初回 `db` access 時に実行される。`hooks.server.ts` の handle
		// 先頭で `getOrInitDb()` を呼ぶことで「any HTTP request の前に DB connection が
		// 確立されている」を保証する。idempotent (2nd 以降は cached) のため副作用なし。
		//
		// E2E 環境 (Playwright webServer → globalSetup の順) ではこの guard により
		// preview server module load 時 (T+0s) でなく 1st HTTP request 時 (T+5s 以降、
		// globalSetup 完了後) に DB が open されるため、Round 10 H-1 (schema cache
		// invalidation 失敗) が構造的に解消される。
		getOrInitDb();

		// #3620 AC-C2 (ADR-0064 案 C): DATA_SOURCE=pglite の非同期 init guard。PGlite の open +
		// migration は非同期のため、同期 getRepos() が ready singleton を使えるよう request 処理前に
		// 接続を確立する。idempotent (2nd 以降は cached Promise 即 return) で他 backend では no-op。
		if (env.DATA_SOURCE === 'pglite') {
			await initPgliteConnection();
		}

		// #2994: operator-level PIN reset (PARENT_PIN_RESET env)。プロセスごと初回のみ実評価、
		// 2 回目以降は同期 return。DB 接続確立 (getOrInitDb) 後である必要がある。
		await applyOperatorPinResetIfRequested();

		// 0-a) メンテナンスモード（Lambda環境変数で切替）
		// /api/ready (LWA readiness、#3657) も除外 — メンテ中に 503 を返すと cold start の
		// LWA が never-ready になり、メンテページ (503) の代わりに 502 が外形になる。
		if (MAINTENANCE_MODE && path !== '/api/health' && path !== '/api/ready') {
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

		// 0-a2) front door 検査 (#4280 案 b)
		//
		// CloudFront を経由しない `/admin` `/api/v1/admin` `/ops` 到達を塞ぐ。rate limiter より
		// **前**に置く: 迂回試行で rate limit の枠を消費させない + 判定が header 比較 1 回で最も安い。
		// `/api/stripe/webhook` `/api/cron/*` `/api/health` は保護対象外のため、Function URL 直の
		// 既存経路 (Stripe / cron-dispatcher / LWA readiness) は従来どおり通る。
		const frontDoorBlock = checkFrontDoor(event, path);
		if (frontDoorBlock) return frontDoorBlock;

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

		// 1) デモ実行モード判定 — env-only (ADR-0048 / PR-B4 / #2189)
		//
		// Multi-Lambda demo deployment (demo.ganbari-quest.com) は AUTH_MODE=anonymous +
		// DATA_SOURCE=demo の Lambda 専用デプロイ (ADR-0048 §設計)。本番 Lambda
		// (ganbari-quest.com) は AUTH_MODE=cognito + DATA_SOURCE=sqlite|dynamodb。
		// demo 判定は env 1 軸のみで完結する。
		//
		// 経緯:
		// - ADR-0039 (#1180) 当初: query (`?mode=demo`) / cookie (`gq_demo=1`) / path (`/demo/*`)
		//   の 3 signal で `src/routes/demo/**` を本番ルート上にホイスト
		// - PR-B1 (#2143 merged): Pattern A (env-only fallback) として `isDemoLambda(authMode)` を
		//   OR 合流追加。legacy 3 signal は backward compat 維持
		// - PR-B3 (#2188 merged): `src/routes/demo/**` 物理撤去 → path signal が dead
		// - PR-B4 (本 commit, #2189): cookie / query signal も demo Lambda subdomain で
		//   代替済のため撤去 → env-only に単一化完了
		//
		// prerender 中は SvelteKit が url.searchParams へのアクセスを禁ずる
		// （deterministic でなくなるため）。building 時はデモ判定をスキップして
		// false 固定にする — 静的ページは常に非デモ状態で生成される。
		event.locals.isDemo = building ? false : resolveDemoActive(env);

		// ADR-0040 P2: 実行モードをリクエスト単位で解決。以降のガード／UI 出力は
		// 本モードを起点に判断する想定（P4 で capability gate に昇格予定）。
		// isDemo 解決より後に呼ぶことで、env-only demo 判定を 'demo' に落とし込む。
		event.locals.runtimeMode = resolveRuntimeMode({
			env,
			pathname: path,
			isBuilding: building,
			isDemoRequest: event.locals.isDemo,
		});

		// PR-B4 (#2189): demo cookie 機構 + 専用 `/demo/exit` ハンドラは env-only 化により撤去済。
		// 旧 `/demo/exit` の bookmark 救済は `legacy-url-map.ts` の `/demo/exit → /` entry で代替。

		// 3) デモ状態なら書き込みを 200 no-op で抑止
		//
		// #2558 bug-1 構造的修正: form action (`x-sveltekit-action: true`) には SvelteKit が
		// 認識可能な `ActionResult` ({ type: 'success', data: devalue(...) }) を返す。
		// 従来の素の `{ ok: true, demo: true }` は `use:enhance` の `deserialize()` 後
		// `result.type === undefined` となり、UI の `result.type === 'success'` 分岐
		// (onimported / onclose) が永久に発火せず「ボタン無反応・dialog 閉じない」(機能
		// dead-end) を生んでいた (初顧客レビューで 1 分で発覚)。`buildDemoNoopResponseBody`
		// が SSOT で body 形状を決める (admin 配下の全 use:enhance form に効く)。
		// 実際の DB・外部 API は呼ばれないので副作用なし（Stripe test mode と同じ設計）。
		//
		// ADR-0040 P4 (#1217): 判定は `shouldReturnDemoNoop` に切り出し Policy Gate
		// `can(ctx, 'write.db')` 経由で評価する。`demo-readonly` 理由のみ no-op にし、
		// 他の write 拒否理由 (build-time-readonly) は P4.1 以降で個別ガードに置き換える。
		if (shouldReturnDemoNoop(event.request.method, path, event.locals.runtimeMode)) {
			logger.info(`Demo write no-op: ${event.request.method} ${path}`, {
				requestId: event.locals.requestId,
				path,
			});
			return json(buildDemoNoopResponseBody(event.request.headers));
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

		// #3963: 課金状態を DB から解決できない場合、context は発行されない (fail-closed)。
		// これを「未認証」として扱ってログイン画面へ送ると、認証は生きているのに
		// 「ログアウトさせられた / アカウントが消えた」とユーザーに誤解される。
		// 一時的な障害であることが読み取れる 503 を返す (PO 判断 2026-07-26)。
		let resolvedContext: AuthContext | null;
		try {
			resolvedContext = await provider.resolveContext(event, identity);
		} catch (e) {
			if (!(e instanceof TenantEntitlementUnavailableError)) throw e;
			// health / readiness probe は課金状態に依存しないため 503 にしない
			// (PO 決裁 2026-07-29 merge 条件、`ENTITLEMENT_FAILURE_EXEMPT_PATHS` 参照)。
			if (!isEntitlementFailureExemptPath(path)) {
				return respondEntitlementUnavailable(event, e);
			}
			resolvedContext = null;
		}

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
		// P3 スコープでは mode のみ真面目に投影し、user / plan の詳細投影は P4 で
		// capability 判定が必要になった時点で追加する（resolvePlanTier の I/O を hooks で
		// 先取りしないため）。既存の event.locals.* は互換のため変更しない。
		// #2813 (Phase 7 PR-L2): license key 全廃により licenseKey 注入経路を撤廃。
		// NUC は信頼ベースで mode のみから write 可否が決まる (capabilities.ts canWriteDb)。
		setEvaluationContext(buildEvaluationContext({ mode: event.locals.runtimeMode }));

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
				// #4644: オフライン着地ページ。sitemap.xml と同じくプリレンダ対象であり、
				// 除外しないと /setup へ 302 されてビルド時に静的化できない。加えて実行時も
				// 「オフラインなのに /setup へ飛ばそうとして更に失敗する」ことを避ける。
				path !== '/offline' &&
				// #1601: 配信停止リンクは未認証 + セットアップ前でもアクセス可能にする
				// （特定電子メール法準拠: クリックしたら確実に解除できる必要がある）。
				!path.startsWith('/unsubscribe/') &&
				// #1594 ADR-0023 I8: founder 直接相談動線は公開ページ（未認証 / セットアップ前でもアクセス可）
				!path.startsWith('/inquiry/founder') &&
				!path.startsWith('/api/v1/inquiry/founder') &&
				// #1598 ADR-0023 I7: PMF 判定アンケート (Sean Ellis Test) は HMAC トークン認証で
				// メールリンクから直接アクセスする。セットアップ前でもアクセス可能にする。
				!path.startsWith('/survey/') &&
				// #4696: 全削除の直後は子供 0 人 = セットアップ必須になるが、そこで復元画面まで
				// 遮断すると「エクスポートしておいてください」と案内しておきながら**バックアップから
				// 戻せない**(ダミーの子供を登録するしか手が無い)。データ設定画面と import API だけは
				// セットアップ前でも通す (復元すれば子供が戻り、セットアップ必須も自然に解ける)。
				path !== '/admin/settings/data' &&
				!path.startsWith('/api/v1/import')
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
		// #4701: `?next=` を見る判定 (ログイン済みで /auth/login に来た顧客の転送先) のため url も渡す
		const authResult = provider.authorize(path, identity, context, event.url);
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

		// 退会 (アカウント削除) 申請済みテナントの読み取り専用制御（#0193 / #3993）
		//
		// #3993: 旧実装は条件が `tenantStatus === GRACE_PERIOD` だった。しかし `grace_period` は
		// **支払い失敗の dunning 猶予**でも書かれる (`handlePaymentFailed`)。その結果、
		// カードの期限切れで決済が 1 回失敗しただけで **7 日間すべての書き込みが 403** になり、
		// 子どもががんばりを 1 件も記録できなくなっていた。
		//
		// これは要件の明文違反である (`phase1-dunning-requirements.md`):
		//   FR-1  invoice.payment_failed で past_due 記録、**plan tier は有料維持**
		//   NFR-3 **子供の利用体験は支払い状態で突然中断しない**
		//   US-4  (子供) 親の支払い状態に関わらず通知・アクセス断を経験しない
		//
		// 本ロックが本来対象とすべきは **退会 (アカウント削除) 申請済み**のテナントであり
		// (#0193「アカウント削除UI・猶予期間制御・データ削除バッチ」)、その状態は
		// `families.status` ではなく settings の `soft_deleted_at` が持つ
		// (`grace-period-service.softDeleteTenant` は families を一切触らない)。
		//
		// 判定を `soft_deleted_at` に付け替える。**書き込み要求のときだけ**問い合わせるのは、
		// 読み取りが大半を占める中で全リクエストに settings 参照を足さないため。
		const method = event.request.method;
		const isWriteRequest = method !== 'GET' && method !== 'HEAD';
		if (isWriteRequest && context?.tenantId) {
			// 退会申請中でも「データを持ち出す」「退会を取り消す」「ログアウトする」は通す。
			// これらを塞ぐと、申請を撤回する手段まで失う。
			const isAllowedWritePath = [
				'/api/v1/admin/account/restore',
				'/api/v1/admin/account/export',
				'/api/v1/export',
				'/api/v1/auth/logout',
				'/auth/logout',
			].some((p) => path.startsWith(p));

			if (!isAllowedWritePath && (await isTenantSoftDeleted(context.tenantId))) {
				if (path.startsWith('/api/')) {
					return new Response(
						JSON.stringify({ error: 'アカウント削除の手続き中です。読み取り専用モードです。' }),
						{ status: 403, headers: { 'Content-Type': 'application/json' } },
					);
				}
				// フォーム送信等は設定画面にリダイレクト
				redirect(302, '/admin/settings?reason=account_deletion_pending');
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
		//
		// #4497: 子供セッションは対象外。同意主体は保護者であり (privacy.html 第9条「お子さま本人が
		// アカウントを作成することはできません」)、子供に法務文書のチェックボックスを操作させると
		// 同意を得る相手を間違える。UX 上も、3-5 歳のひらがな画面の子が「越境移転」「施行規則17条2項」の
		// 文書に突き当たり、同意後は行き場のない /admin へ飛ばされる (ADR-0012 の最短経路にも反する)。
		// 保護者は /admin 等でこの gate に掛かるので、再同意の取得自体は保護者側で成立する。
		//
		// この分岐が実際に発火するのは本 PR の version bump が初めてであり、それまでは
		// 「誰も再同意対象にならない」ため潜在していた (#4497 で顕在化)。
		if (
			authMode === 'cognito' &&
			!COGNITO_DEV_MODE &&
			identity &&
			context?.tenantId &&
			context.role !== 'child' &&
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

		// #4721: cron endpoint が実際に呼ばれたことを記録する (NUC の scheduler 生死観測)。
		//
		// **受けた側で記録する**ことに意味がある — scheduler コンテナが起動していない /
		// 古いままで registry の新ジョブを知らない、という状態は「何も起きない」形で現れ、
		// log にも画面にも出ないため鮮度でしか捕まえられない。記録は `/api/health` が読む。
		// 記録側は失敗しても cron 本体を落とさない (観測装置が本処理を止めない)。
		if (response.ok) {
			const cronJobName = cronJobNameFromPath(path);
			if (cronJobName) recordCronRun(cronJobName);
		}

		// 3) セキュリティヘッダ付与
		// Content-Security-Policy は SvelteKit 標準 CSP (svelte.config.js kit.csp) が
		// ページレスポンスに付与するため、ここでは set しない (#3829、clobber 除去)。
		// X-Frame-Options は SSR / 動的レスポンス全てに付与し、対話 HTML の clickjacking を防ぐ。
		// prerender ページ (sitemap.xml、非対話 XML) は静的化され本 hooks を経由しないため
		// 本 header は乗らないが、非対話 XML で実害なし (#3833 で実挙動を確認)。
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
			// #4192: tenantId は Discord に載せない (#4174 Q3)。上の logger.error が保持する。
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
