// src/lib/server/db/pglite/connection.ts
// EPIC #3620 AC-C1 (ADR-0064 案 C) / 設計 SSOT: docs/decisions/0064-sqlite-core-repo-strategy.md
//   + docs/design/dsql/dsql-data-model.md §8 (SqlExecutor) / §12.2 (cutover round-trip)
//
// ── 採用形 (ADR-0064 案 C = PGlite for NUC) ─────────────────────────────────
// NUC (セルフホスト) を組込 Postgres (PGlite = Postgres WASM) で駆動し、DSQL (pg-core) の
// schema + repos 33 本を **verbatim 再利用**する (dialect 税ゼロ)。cloud `dsql/connection.ts` と
// 対の lazy-singleton 接続層で、repo は本 db (SqlExecutor 面) と runner を factory 注入で受ける。
//
// cloud (AuroraDSQLPool) との差分:
//   - 接続先 = リモート DSQL cluster ではなく **ローカル PGlite プロセス** (単一 WASM、単一接続)。
//   - OCC 40001 は PGlite では発生しない (実 pg の locking を持つ = FOR UPDATE 本物、write-skew
//     原理的に不在)。withOccRetry は no-op として通る (createDsqlTransactionRunner を共用)。
//   - 永続化 = Node FS VFS (`PGLITE_DATA_DIR`)。未設定なら in-memory (test/dev)。
//   - timezone = 明示的に UTC 固定 (`SET TIME ZONE 'UTC'`)。DSQL は UTC 固定 (P10) のため、
//     PGlite のローカル TZ 継承で ::timestamptz 境界がズレないよう parity を強制する (ADR-0064 §gate)。
//
// ── schema 適用 (drizzle-kit を本番依存にしない) ───────────────────────────
// 本番 PGlite は drizzle-kit (devDependency) を実行時に持たないため、schema は **dev 時に
// drizzle.pglite.config.ts で生成した migration SQL (drizzle/pglite/)** を drizzle-orm/pglite
// migrator で boot 時適用する。test は同 migration を temp dataDir に適用して契約検証する。
//
// ⚠️ 非同期契約: PGlite の open + migrate は async。cloud の getDsqlDb() (sync) と異なり本層の
//   getter は Promise を返す。factory の同期 getRepos() への結線 (async init 前置き) は AC-C2。

import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { getEnv } from '$lib/runtime/env';
import { createDsqlTransactionRunner } from '../dsql/run-in-transaction';
import * as schema from '../dsql/schema';
import type { TransactionRunner } from '../interfaces/transaction.interface';

/** PGlite backend の Drizzle database 型 (pglite 方言、pg-core schema)。SqlExecutor を構造的に満たす。 */
export type PgliteDatabase = ReturnType<typeof drizzle<typeof schema>>;

/** drizzle の transaction() が callback に渡す tx handle 型。SqlExecutor を構造的に満たす。 */
export type PgliteTx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0];

// ── module scope singleton state (プロセス内で 1 PGlite を再利用) ──
let _client: PGlite | null = null;
let _db: PgliteDatabase | null = null;
let _runner: TransactionRunner<PgliteTx> | null = null;
let _ready: Promise<void> | null = null;

/** 生成済み migration (drizzle/pglite) の解決先。env 上書き可、既定は cwd 相対。 */
function migrationsDir(): string {
	const env = getEnv();
	return env.PGLITE_MIGRATIONS_DIR ?? resolve(process.cwd(), 'drizzle', 'pglite');
}

/**
 * PGlite client / drizzle db / runner を **idempotent に確立**する。
 * open → SET TIME ZONE 'UTC' → migration 適用 を 1 度だけ実行し、以後は既存 singleton を返す。
 * `PGLITE_DATA_DIR` 設定時は FS 永続、未設定時は in-memory (test/dev)。
 */
export async function initPgliteConnection(): Promise<void> {
	if (_ready) return _ready;
	_ready = (async () => {
		const env = getEnv();
		// #3620 QM residual #2 (security guardrail): AWS Lambda 上で PGlite を開くことを物理拒否する。
		// DATA_SOURCE=pglite が誤って cloud Lambda に配布されると、単一接続の PGlite に全家族の
		// データが集約され ADR-0063 の tenant 分離 (DSQL pool + 偽造不能 tenantId) が config ミス
		// 1 つで消失する。PGlite を開く唯一の入口である本関数の先頭で fail-loud する
		// (self-heal は rejected init を破棄するため、誤設定が直るまで毎回 throw = silent 稼働なし)。
		//
		// 判定は resolveRuntimeMode でなく **生の AWS_LAMBDA_FUNCTION_NAME を直接検査**する
		// (adversarial review 指摘): resolveRuntimeMode は APP_MODE override / IS_NUC_DEPLOY を
		// Lambda 判定より先に評価するため、Lambda 上に APP_MODE=nuc-prod や IS_NUC_DEPLOY=true が
		// 誤設定されると 'aws-prod' 判定が bypass される。AWS_LAMBDA_FUNCTION_NAME は AWS Lambda
		// ランタイム自身が必ず設定する env で config では偽装/解除できず、正当な Lambda 用途に
		// pglite backend は存在しない (本番=dsql / demo=demo / staging=dsql|dynamodb) ため、
		// この生 signal での拒否が最も強い不変条件になる。
		if (env.AWS_LAMBDA_FUNCTION_NAME && env.AWS_LAMBDA_FUNCTION_NAME.length > 0) {
			throw new Error(
				'PGlite backend is forbidden on AWS Lambda: DATA_SOURCE=pglite would ' +
					'collapse all tenants into a single local store and void ADR-0063 tenant isolation. ' +
					'Use DATA_SOURCE=dsql on AWS. (#3620 QM residual #2, ' +
					`AWS_LAMBDA_FUNCTION_NAME=${env.AWS_LAMBDA_FUNCTION_NAME})`,
			);
		}
		// dataDir 未設定 = in-memory (PGlite は引数なしで in-memory)。設定時は FS VFS で永続化。
		_client = env.PGLITE_DATA_DIR ? new PGlite(env.PGLITE_DATA_DIR) : new PGlite();
		await _client.waitReady;
		// DSQL parity: timezone を UTC 固定 (::timestamptz 境界の TZ ズレ防止、ADR-0064 §gate)。
		// **接続レベル保証** (#3628 QM follow-up): `SET TIME ZONE` は session-level のため接続再取得
		// / multiplexing / singleton 再生成で脱落し、子供の記録が日付境界で 1 日ズレる無言毀損の余地
		// がある。`ALTER DATABASE ... SET timezone` は DB 既定として pg_database catalog に永続し
		// (dataDir 永続時は reopen 後も有効)、以後の全 session に UTC を適用する = 脱落しない。
		// 現 session には ALTER が効かないため session SET も併用する (両輪)。
		const dbNameRes = await _client.query<{ current_database: string }>(
			'SELECT current_database()',
		);
		const dbName = dbNameRes.rows[0]?.current_database ?? 'postgres';
		// #3629 QM follow-up: dbName は current_database() 由来で安全だが、識別子補間の同型コピーで
		// SQL injection を招かないよう安全な識別子形状を明示 assert する (parameterize 不能な
		// DDL 識別子の防御。unsafe pattern の横展開防止)。
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
			throw new Error(`[pglite/connection] 不正な database 識別子: ${dbName}`);
		}
		// #3629 QM follow-up (両輪、誤除去防止): 下記 2 文は片方だけでは UTC を保証できない。
		//   ALTER DATABASE = 以後の全 session の既定 (現 session には効かない、pg_db_role_setting 永続)。
		//   SET TIME ZONE  = 現 session のみ。両方あって初めて「現 session も将来 session も UTC」。
		await _client.exec(`ALTER DATABASE "${dbName}" SET timezone TO 'UTC';`);
		await _client.exec("SET TIME ZONE 'UTC';");
		_db = drizzle(_client, { schema });
		// 生成済み pg-core migration を適用 (drizzle-kit 非依存、本番 boot 経路)。
		await migrate(_db, { migrationsFolder: migrationsDir() });
		_runner = createDsqlTransactionRunner<PgliteTx>(_db);
	})().catch((err) => {
		// #3630 QM follow-up (self-heal): init が reject すると `_ready` に rejected promise が残り、
		// 以後の全呼出が `if (_ready) return _ready` で恒久的に同じ失敗を返す (permanent brick、retry
		// 不能)。失敗時は singleton 状態を破棄し、次回呼出で再 init を試せるようにする (成功は memoize
		// 維持)。self-heal を `_ready` 自体に付けるため並列呼出も同一 promise を共有する。
		const failedClient = _client;
		_client = null;
		_db = null;
		_runner = null;
		_ready = null;
		if (failedClient) void failedClient.close().catch(() => {}); // best-effort cleanup
		throw err;
	});
	return _ready;
}

/**
 * PGlite backend の Drizzle client を返す (singleton、await 必須)。
 * repo (createDsql*Repo) はこの db (SqlExecutor 面) と getPgliteTransactionRunner() を
 * factory 注入で受け取る (fitness#8: module-level db import 禁止)。
 */
export async function getPgliteDb(): Promise<PgliteDatabase> {
	await initPgliteConnection();
	if (!_db) throw new Error('[pglite/connection] init 後も db が null です (到達不能)');
	return _db;
}

/** PGlite backend の TransactionRunner を返す (singleton、await 必須)。 */
export async function getPgliteTransactionRunner(): Promise<TransactionRunner<PgliteTx>> {
	await initPgliteConnection();
	if (!_runner) throw new Error('[pglite/connection] init 後も runner が null です (到達不能)');
	return _runner;
}

/**
 * #3620 AC-C2: 同期 factory (getRepos) 用の **init 済み前提** アクセサ。
 * PGlite init は非同期のため、request 前に `initPgliteConnection()` を await 済みであること
 * (hooks.server.ts の 1st-request guard) を前提に、同期で ready singleton を返す。
 * 未 init で呼ばれた場合は明示 throw する (silent な空 backend を作らせない)。
 */
export function getPgliteDbSync(): PgliteDatabase {
	if (!_db) {
		throw new Error(
			'[pglite/connection] init 未完了。DATA_SOURCE=pglite では request 前に ' +
				'initPgliteConnection() を await すること (hooks.server.ts の 1st-request guard)。',
		);
	}
	return _db;
}

/** #3620 AC-C2: 同期 factory 用の init 済み TransactionRunner アクセサ (getPgliteDbSync と同契約)。 */
export function getPgliteTransactionRunnerSync(): TransactionRunner<PgliteTx> {
	if (!_runner) {
		throw new Error(
			'[pglite/connection] init 未完了。DATA_SOURCE=pglite では request 前に ' +
				'initPgliteConnection() を await すること (hooks.server.ts の 1st-request guard)。',
		);
	}
	return _runner;
}

/** テスト専用: singleton 状態を破棄し PGlite プロセスを close する。 */
export async function resetPgliteConnectionForTesting(): Promise<void> {
	const client = _client;
	_client = null;
	_db = null;
	_runner = null;
	_ready = null;
	if (client) await client.close();
}
