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
 */
export const DEMO_WRITE_ALLOWLIST: readonly string[] = [
	'/api/feedback',
	'/api/demo-analytics',
	'/api/demo/exit',
	'/api/health',
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
 * 書き込みパスがガード例外に該当するか。
 */
export function isDemoWriteAllowed(path: string): boolean {
	return DEMO_WRITE_ALLOWLIST.some((prefix) => path.startsWith(prefix));
}
