/**
 * Demo execution mode — entry/exit resolver.
 *
 * ADR-0039: `src/routes/demo/**` の別ルートツリーを廃止し、本番ルート上で
 * `?mode=demo` クエリ → `gq_demo` cookie → `event.locals.isDemo` の 3 段で
 * デモ実行モードを判定する。
 *
 * #296 / #1129 / #1147 / #1180 の 4 連続デザイン乖離の構造的解消が目的。
 */

/** Cookie 名。4h 失効（短命デフォルト）で誤持続を防ぐ。 */
export const DEMO_MODE_COOKIE = 'gq_demo';

/** cookie 有効期限（秒）。4 時間。 */
export const DEMO_MODE_COOKIE_MAX_AGE = 60 * 60 * 4;

/** デモモードで書き込みを no-op 化する HTTP メソッド。 */
export const DEMO_WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 書き込み no-op ガードから除外するパス（前方一致）。
 * デモ状態でも実際に処理する必要のある write エンドポイント。
 *
 * - `/api/feedback`: デモユーザーからのフィードバック受付（Discord 通知）
 * - `/api/demo-analytics`: デモファネル分析（funnel tracking）
 * - `/api/demo/exit`: デモ退出（cookie 削除）
 * - `/api/health`: ヘルスチェック
 * - `/demo/`: Phase 1 backward compat。legacy /demo/** 配下の form actions は
 *   すでに demo-service 経由で in-memory に閉じている（実 DB を叩かない）ため
 *   guard で no-op 化すると結果データが返らず UI が壊れる。Phase 2 で /demo/**
 *   を削除した際に本エントリも削除する。
 * - `/switch`: 子供切替の form action (`?/select`)。実 DB に書き込まず cookie
 *   `selectedChildId` を set + redirect するだけのため demo 安全。no-op で
 *   `{ ok: true, demo: true }` を返すと SvelteKit form action が成功と認識せず
 *   redirect が発火しないため、demo Lambda で `/switch` の子供クリックが
 *   動かない (#2097 Phase B Bug 4)。本パス追加で本番ルートを通常駆動する。
 *   demo context は `tenantId: 'demo'` で hooks に注入済みなので
 *   `requireTenantId` も通る。
 */
export const DEMO_WRITE_ALLOWLIST: readonly string[] = [
	'/api/feedback',
	'/api/demo-analytics',
	'/api/demo/exit',
	'/api/health',
	'/demo/',
	'/switch',
];

/**
 * デモ実行中か判定する。
 *
 * - `?mode=demo` クエリ（入口専用）
 * - cookie `gq_demo=1`（モード維持）
 * - `/demo/*` プレフィックス（Phase 1 の backward compat。Phase 2 で削除予定）
 */
export function resolveDemoActive(
	query: string | null,
	cookie: string | undefined,
	path?: string,
): { isDemo: boolean; fromQuery: boolean; fromLegacyPath: boolean } {
	const fromQuery = query === 'demo';
	const fromCookie = cookie === '1';
	const fromLegacyPath = path?.startsWith('/demo') ?? false;
	return { isDemo: fromQuery || fromCookie || fromLegacyPath, fromQuery, fromLegacyPath };
}

/**
 * Multi-Lambda demo deployment (demo.ganbari-quest.com) の判定。
 *
 * ADR-0048 §Phase B-1 / Issue #2097: `AUTH_MODE=anonymous` の Lambda は demo Lambda
 * 専用デプロイのため、リクエストのクエリ・cookie・パスに関係なく `isDemo=true` として
 * 扱う必要がある。`resolveDemoActive()` の従来の 3 経路（query / cookie / `/demo/*`）の
 * いずれもセットされない素のアクセス（例: `/admin`）で onboarding が表示される問題
 * (A-6 ISSUE-003) の構造的解消。
 *
 * 既存の legacy 3 経路（cookie / `/demo/*`）は NUC local モード等の運用維持のため
 * そのまま保持し、本関数は OR 演算でフォールバックとして合流させる。
 */
export function isDemoLambda(authMode: string | undefined): boolean {
	return authMode === 'anonymous';
}

/**
 * 書き込みパスがガード例外に該当するか。
 */
export function isDemoWriteAllowed(path: string): boolean {
	return DEMO_WRITE_ALLOWLIST.some((prefix) => path.startsWith(prefix));
}
