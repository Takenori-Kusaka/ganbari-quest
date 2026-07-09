// src/lib/server/db/dsql/connection.ts
// EPIC #3424 / M4-B② 接続層 / 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.3 (F1)
//   + docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 9 (#3426、接続方式 実測確定)
//   + docs/design/dsql/m3-physical-model.md §3.4 (実行時接続ロールモデル [must]B6)
//   + docs/decisions/0063-dsql-pool-multitenant-isolation.md (単一 pool + tenant 述語)
//
// ── 採用形（実測確定、検証 9 / F1）─────────────────────────────────────────
// connector `@aws/aurora-dsql-node-postgres-connector` の `AuroraDSQLPool` を **Lambda
// module scope に 1 個 (singleton)** 保持 → `drizzle-orm/node-postgres` の `drizzle(pool)`
// を **無改変で被せる**。warm ~4ms / cold ~120ms (接続確立) で実行コンテキスト跨ぎの
// 接続再利用を PoC で実証済 (検証 9 (a)/(d))。
//
// connector が肩代わりする DSQL 固有ボイラープレート (検証 9 (b)/(c)、ADR README §OSS 先調査):
//   - IAM token の自動生成・更新 (60 分期限、新規物理接続ごとに fresh token を発行)
//   - hostname (`<id>.dsql.<region>.on.aws`) からの region 自動判定
//   - `AuroraDSQLPool.transaction()` の OCC (40001/OC000) 自動 retry helper
//
// ⚠️ OCC retry の役割分担 (§3.11 reuse 整理): 本 backend の write path は drizzle の
//    `db.transaction()` (createDsqlTransactionRunner) を通る。drizzle は BEGIN/COMMIT を
//    自前で発行し connector の `pool.transaction()` を経由しない。したがって Drizzle 経路の
//    OCC 40001 bounded retry は **本プロジェクトの `withOccRetry` (occ-retry.ts) が担う**。
//    connector 内蔵 retry は生 `pool.transaction()` 直呼び時のみ効く (本 backend では未使用)。
//
// ── IAM ロール前提（M3 §3.4 [must]B6。実 policy JSON 配線は M5 cutover gate）─────
//   - **アプリ実行時**: この pool は Lambda 実行 role の AWS クレデンシャル (default provider
//     chain) を connector 経由で使い、`dsql:DbConnect`（最小権限 postgres role = admin でない）
//     で接続する前提。append-only 表 (consents / point_ledger / status_history / *_logs /
//     trial_history / cancellation_reasons / graduation_consents / notification_logs) への
//     UPDATE/DELETE grant を持たない role で稼働することで台帳追記性を DB GRANT で物理担保する。
//   - **migration / admin**: DDL・GRANT 管理は別クレデンシャル `dsql:DbConnectAdmin` を使う
//     独立経路 (migration runner、M4-B① 別 PR)。アプリ実行経路から到達不能に保つ。
//   - ⚠️ 実 IAM policy JSON (DbConnect 最小権限 + append-only GRANT 除外 / DbConnectAdmin 分離)
//     の実装は **本番 cutover 前 hard blocker (M5)**。ここでは接続コードが前提とする role を
//     宣言するに留め、policy 配線自体は行わない (§3.9 境界)。
//
// ── fallback（実装しない、記述のみ）──────────────────────────────────────
// connector が使えない特殊制約が出た場合の fallback は「pg.Pool + `@aws-sdk/dsql-signer` の
// `DsqlSigner`」直結 (pg の async `password` 関数で新規物理接続ごとに admin auth token を都度
// 発行)。ただし token 更新・region 判定・OCC retry を全て自前実装する必要があり、PoC で
// connector と性能同等と確認済 (検証 9) のため採用しない。本コメントを唯一の記述とする。

import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getEnv } from '$lib/runtime/env';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import { createDsqlTransactionRunner } from './run-in-transaction';
import * as schema from './schema';

/** DSQL backend の Drizzle database 型 (node-postgres 方言、pg-core schema)。 */
export type DsqlDatabase = ReturnType<typeof drizzle<typeof schema>>;

/** drizzle の transaction() が callback に渡す tx handle 型。SqlExecutor を構造的に満たす。 */
export type DsqlTx = Parameters<Parameters<DsqlDatabase['transaction']>[0]>[0];

// ── module scope singleton state (Lambda 実行コンテキスト跨ぎで再利用、検証 9) ──
let _pool: AuroraDSQLPool | null = null;
let _db: DsqlDatabase | null = null;
let _runner: TransactionRunner<DsqlTx> | null = null;

/**
 * connector `AuroraDSQLPoolConfig` を組み立てる。
 *
 * - `host` = DSQL cluster endpoint (`DSQL_ENDPOINT`、CDK GetAtt `attrEndpoint` から Lambda env へ
 *   注入。検証 8)。region は connector が hostname から自動判定するため明示不要 (検証 9 (b))。
 * - `user` = postgres role。実行時は `dsql:DbConnect` 最小権限 role にマップされる db user
 *   (`DSQL_USER`、既定 `admin` は PoC/検証用。本番の最小権限 role 名は M5 で確定)。
 * - `database` = 常に `postgres` (DSQL は単一 database、M3 接続前提)。
 * - `ssl` = DSQL は TLS 必須 (検証 1)。connector が証明書検証込みで確立する。
 */
function buildDsqlPoolConfig(): ConstructorParameters<typeof AuroraDSQLPool>[0] {
	// ADR-0040 P1: env は $lib/runtime/env 経由 (envSchema で optional 宣言済み)。
	// DSQL_* は「DATA_SOURCE=dsql を選んだときだけ」意味を持つ条件付き設定であり、
	// 現行本番 (dynamodb) では不要。実配布は M5 cutover (CDK attrEndpoint → Lambda env)。
	const env = getEnv();
	const endpoint = env.DSQL_ENDPOINT;
	if (!endpoint) {
		throw new Error(
			'[dsql/connection] DSQL_ENDPOINT が未設定です。DATA_SOURCE=dsql で起動する場合のみ ' +
				'cluster endpoint (CDK GetAtt attrEndpoint → Lambda env、M5 cutover で配布) を設定してください。' +
				'm4-implementation-plan.md §3.3 参照。',
		);
	}
	return {
		host: endpoint,
		user: env.DSQL_USER ?? 'admin',
		database: env.DSQL_DATABASE ?? 'postgres',
		ssl: true,
		// connector が region を hostname から自動判定 (検証 9 (b))。token 生成・更新も connector 任せ。
	};
}

/**
 * DSQL connector pool を **idempotent に確立**する (module scope singleton)。
 * 2 回目以降は既存 pool を即 return し、実行コンテキスト跨ぎで物理接続を再利用する (検証 9 (a))。
 */
export function getDsqlPool(): AuroraDSQLPool {
	if (_pool) return _pool;
	_pool = new AuroraDSQLPool(buildDsqlPoolConfig());
	return _pool;
}

/**
 * DSQL backend の Drizzle client を返す (singleton)。
 *
 * **Drizzle client 生成の唯一の集約点** (DoD): `drizzle(pool, { schema })` はコードベース中
 * 本関数の 1 箇所でのみ呼ばれる。repo (createDsqlChildRepo 等) はこの `db` (SqlExecutor 面) と
 * getDsqlTransactionRunner() を factory 注入で受け取る (fitness#8: module-level db import 禁止)。
 */
export function getDsqlDb(): DsqlDatabase {
	if (_db) return _db;
	_db = drizzle(getDsqlPool(), { schema });
	return _db;
}

/**
 * DSQL backend の TransactionRunner を返す (singleton)。
 * drizzle の `db.transaction()` を withOccRetry でラップする (OCC 40001 bounded retry、§3.11)。
 */
export function getDsqlTransactionRunner(): TransactionRunner<DsqlTx> {
	if (_runner) return _runner;
	_runner = createDsqlTransactionRunner<DsqlTx>(getDsqlDb());
	return _runner;
}

/**
 * テスト専用: singleton 状態を破棄する。
 * pool の物理接続 close は connector (pg.Pool) の `end()` を await して行う。
 */
export async function resetDsqlConnectionForTesting(): Promise<void> {
	const pool = _pool;
	_pool = null;
	_db = null;
	_runner = null;
	// AuroraDSQLPool extends pg.Pool; end() は @types/pg 未導入環境で型が引けないため narrow cast。
	if (pool) await (pool as unknown as { end(): Promise<void> }).end();
}
