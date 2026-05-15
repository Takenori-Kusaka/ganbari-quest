/**
 * Demo execution mode — entry/exit resolver.
 *
 * ADR-0039 Phase 2 (#2097, 2026-05-15): `src/routes/demo/**` の別ルートツリーを
 * 完全廃止し、本番ルート上で `?mode=demo` クエリ → `gq_demo` cookie →
 * `event.locals.isDemo` の 2 段でデモ実行モードを判定する。
 *
 * Phase 1 まで存在した `path.startsWith('/demo')` の backward compat は
 * Phase 2 完遂と同時に撤去された (47 ファイル削除済)。`/demo/exit` のみ
 * `/api/demo/exit` への 302 redirect として hooks に残る。
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
 * - `/api/demo/exit`: デモ退出（cookie 削除、ADR-0039 Phase 2 で /api/ 配下に移行）
 * - `/api/health`: ヘルスチェック
 *
 * ADR-0039 Phase 2 (#2097): 旧 `/demo/` 前方一致は撤去。`/demo/**` 別ツリー削除で
 * legacy form actions が存在しなくなったため、guard を経由する write は全て
 * `event.locals.isDemo === true` 時に 200 no-op で抑止する。
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
 * ADR-0039 Phase 2 (#2097, 2026-05-15): `path?.startsWith('/demo')` の
 * backward compat 経路は撤去。`?mode=demo` クエリと cookie の 2 段判定のみ。
 *
 * - `?mode=demo` クエリ（入口専用）
 * - cookie `gq_demo=1`（モード維持）
 */
export function resolveDemoActive(
	query: string | null,
	cookie: string | undefined,
): { isDemo: boolean; fromQuery: boolean } {
	const fromQuery = query === 'demo';
	const fromCookie = cookie === '1';
	return { isDemo: fromQuery || fromCookie, fromQuery };
}

/**
 * 書き込みパスがガード例外に該当するか。
 */
export function isDemoWriteAllowed(path: string): boolean {
	return DEMO_WRITE_ALLOWLIST.some((prefix) => path.startsWith(prefix));
}

/**
 * legacy `/demo/exit` の互換性のための path 判定。hooks 側で `/demo/exit` を
 * `/api/demo/exit` に redirect するために使う。Phase 2 完遂後の運用では
 * `/api/demo/exit/+server.ts` が正式エンドポイント。
 */
export function isLegacyDemoExitPath(path: string): boolean {
	return path === '/demo/exit';
}
