/**
 * Demo execution mode — env-only resolver (ADR-0048 PR-B4 / #2189).
 *
 * Multi-Lambda demo deployment (demo.ganbari-quest.com) は AUTH_MODE=anonymous +
 * DATA_SOURCE=demo の Lambda 専用デプロイ (ADR-0048 §設計)。本番 Lambda
 * (ganbari-quest.com) は AUTH_MODE=cognito + DATA_SOURCE=sqlite|dynamodb。
 * demo 判定は env 1 軸のみで完結し、cookie / path / query などの request signal は
 * 不要 (PR-B3 で `src/routes/demo/**` 物理撤去済 → path signal は dead、
 * cookie / query signal は Multi-Lambda subdomain で代替済)。
 *
 * ## 経緯
 *
 * - ADR-0039 (#1180): `src/routes/demo/**` 撤廃 + 3 signal (query / cookie / `/demo/*`)
 *   で本番 routes 上に demo を hoist。8 回のデザイン乖離 (#296 / #1129 / #1147 / #1180) を
 *   構造的に解消する設計
 * - ADR-0048 §Phase B-1 (#2143 merged): Multi-Lambda 設計の Pattern A (env-only fallback) を
 *   `isDemoLambda(authMode)` として OR 合流追加。legacy 3 signal は backward compat 維持
 * - ADR-0048 §Phase B-4 (#2189, 本 commit): `/demo/**` route 物理撤去 (PR-B3 / #2188 merged) で
 *   path signal は dead、cookie signal も demo Lambda 上では Lambda 切替に依存しないため不要、
 *   query signal は Lambda subdomain で代替済 → env-only に単一化完了
 */

import type { TypedEnv } from '$lib/runtime/env';

/** デモモードで書き込みを no-op 化する HTTP メソッド。 */
export const DEMO_WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 書き込み no-op ガードから除外するパス（前方一致）。
 * デモ状態でも実際に処理する必要のある write エンドポイント。
 *
 * - `/api/feedback`: デモユーザーからのフィードバック受付（Discord 通知）
 * - `/api/demo-analytics`: デモファネル分析（funnel tracking）
 * - `/api/health`: ヘルスチェック
 * - `/switch`: 子供切替の form action (`?/select`)。実 DB に書き込まず cookie
 *   `selectedChildId` を set + redirect するだけのため demo 安全。no-op で
 *   `{ ok: true, demo: true }` を返すと SvelteKit form action が成功と認識せず
 *   redirect が発火しないため、demo Lambda で `/switch` の子供クリックが
 *   動かない (#2097 Phase B Bug 4)。本パス追加で本番ルートを通常駆動する。
 *   demo context は `tenantId: 'demo'` で hooks に注入済みなので
 *   `requireTenantId` も通る。
 *
 * #2189 PR-B4 で `/api/demo/exit` (旧 cookie 削除 endpoint) / `/demo/` (legacy /demo/** 配下
 * form actions) を撤去 — PR-B3 で `/demo/**` route 物理削除済のため到達経路がない。
 */
export const DEMO_WRITE_ALLOWLIST: readonly string[] = [
	'/api/feedback',
	'/api/demo-analytics',
	'/api/health',
	'/switch',
];

/**
 * Demo Lambda 判定 — env-only (ADR-0048 / PR-B4 / #2189).
 *
 * Multi-Lambda demo deployment (demo.ganbari-quest.com) は AUTH_MODE=anonymous +
 * DATA_SOURCE=demo の Lambda 専用デプロイ。両 env が demo を示せば demo Lambda、
 * いずれかが本番値なら本番 Lambda として扱う。
 *
 * 開発者が誤って AUTH_MODE=anonymous + DATA_SOURCE=sqlite で起動した場合は
 * **demo 扱いしない**。AnonymousAuthProvider が licenseStatus=ACTIVE を返すスタブと
 * sqlite 実 DB の組合せは本番想定外であり、demo 扱いすると実 DB を read-only にして
 * ローカル開発を壊すリスクがある。env を厳密 AND する。
 *
 * @example
 * ```ts
 * // demo Lambda
 * resolveDemoActive({ AUTH_MODE: 'anonymous', DATA_SOURCE: 'demo' }) // true
 * // 本番 Lambda
 * resolveDemoActive({ AUTH_MODE: 'cognito',   DATA_SOURCE: 'sqlite' }) // false
 * // 開発者 misconfig
 * resolveDemoActive({ AUTH_MODE: 'anonymous', DATA_SOURCE: 'sqlite' }) // false
 * ```
 */
export function resolveDemoActive(env: Pick<TypedEnv, 'AUTH_MODE' | 'DATA_SOURCE'>): boolean {
	return env.AUTH_MODE === 'anonymous' && env.DATA_SOURCE === 'demo';
}

/**
 * 書き込みパスがガード例外に該当するか。
 */
export function isDemoWriteAllowed(path: string): boolean {
	return DEMO_WRITE_ALLOWLIST.some((prefix) => path.startsWith(prefix));
}
