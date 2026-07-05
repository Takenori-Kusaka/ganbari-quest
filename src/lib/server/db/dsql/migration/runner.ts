// src/lib/server/db/dsql/migration/runner.ts
// EPIC #3424 / M4-B① カスタム migration runner (適用オーケストレータ)
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 (F2/F3)
//   実測根拠: docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 2/3 (#3427)
//
// drizzle-kit(pg) 出力 SQL を DSQL へ適用する。schema-diff (drizzle-kit generate) は捨てず、
// その**出力を transform.ts が後処理変換** → 本 runner が **autocommit で 1 文ずつ適用**し、
// ASYNC index の後に build 完了を poll する (§3.2「drizzle の schema-diff を捨てず、出力変換
// だけ独自」)。
//
// ── 適用順序 (責務 4/6 + ASYNC UNIQUE build 順序、hard 制約) ─────────────────
//   1. plan.ddl を順に適用。各文は **autocommit (1 DDL/txn)** — txn 一括禁止 (検証 2)。
//   2. ASYNC index は「発行前に watermark 捕捉 → CREATE INDEX ASYNC → 今回 build に限定した
//      sys.jobs status='completed' poll」の順で適用 (検証 3)。
//      → CREATE TABLE → watermark → ASYNC UNIQUE CREATE → job=completed poll → 書込開放 を保証。
//   3. 全 DDL 適用後に plan.dml (seed) を **別 txn** で適用 — DDL⇄DML 混在禁止 (検証 2)。
//
// ⚠️ executor は **autocommit** であること (drizzle transaction の中で呼ばない)。
//    複数文を 1 BEGIN で束ねると `multiple ddl` / `ddl and dml` で 0A000 になる (検証 2)。
// ⚠️ poll 完了 ≠ ANALYZE 統計反映 (研究 doc §検証7 L139)。二次 index が planner に効くのは
//    ANALYZE 統計反映後であり、build=completed は「uniqueness 強制が有効化された」ことのみを
//    保証する (書込開放の可否)。統計依存クエリの access path は M4-D 以降で EXPLAIN 再確認する。

import { type SQL, sql } from 'drizzle-orm';
import {
	type AsyncIndexPollOptions,
	captureIndexBuildWatermark,
	pollAsyncIndexBuild,
	type RawSqlExecutor,
} from './async-index-poll';
import { type DsqlMigrationPlan, transformDrizzleSqlToDsql } from './transform';

export type { RawSqlExecutor } from './async-index-poll';
export type { DsqlMigrationPlan, DsqlStatement } from './transform';

/**
 * drizzle の db (execute(SQL) 面) を runner の RawSqlExecutor に橋渡しする。
 * 既存 SqlExecutor パターン (sql-executor.ts) と同型: db.execute(sql.raw(...)) を薄くラップ。
 * node-postgres / pglite いずれも `.rows` を返す。
 */
export function createDrizzleRawExecutor(db: {
	execute(query: SQL): Promise<unknown>;
}): RawSqlExecutor {
	return {
		execute: async (raw: string) => {
			const res = (await db.execute(sql.raw(raw))) as { rows?: unknown[] } | undefined;
			return { rows: res?.rows ?? [] };
		},
	};
}

export interface ApplyMigrationOptions extends AsyncIndexPollOptions {
	/** 各文適用前後に呼ばれる観測 hook (任意、ログ用)。 */
	onStatement?: (phase: 'ddl' | 'dml', sqlText: string) => void;
}

/**
 * 変換済み migration plan を DSQL へ適用する。
 *
 * @param plan transformDrizzleSqlToDsql の出力。
 * @param executor **autocommit** で raw SQL を実行する executor (drizzle transaction 外)。
 * @throws ASYNC index build failed/timeout 時 (poll)、または DDL/DML 実行時の driver error。
 */
export async function applyDsqlMigrationPlan(
	plan: DsqlMigrationPlan,
	executor: RawSqlExecutor,
	opts: ApplyMigrationOptions = {},
): Promise<void> {
	// 1. DDL を autocommit で 1 文ずつ適用 + ASYNC index の後に build 完了 poll。
	for (const stmt of plan.ddl) {
		if (stmt.asyncIndexName) {
			// 発行**前**に watermark を捕捉し、今回の build (watermark より新しい行) に限定して
			// poll する (過去 build の completed 行による fail-open を排除、検証 3)。
			const watermark = await captureIndexBuildWatermark(executor, stmt.asyncIndexName);
			opts.onStatement?.('ddl', stmt.sql);
			await executor.execute(stmt.sql);
			// 書込を開放する前に build=completed を待つ (F3 hard 制約)。失敗/timeout は throw。
			await pollAsyncIndexBuild(executor, stmt.asyncIndexName, {
				...opts,
				afterWatermark: watermark,
			});
		} else {
			opts.onStatement?.('ddl', stmt.sql);
			await executor.execute(stmt.sql);
		}
	}
	// 2. 全 DDL 完了後に seed(DML) を別 txn で適用 (DDL⇄DML 混在禁止)。
	for (const stmt of plan.dml) {
		opts.onStatement?.('dml', stmt.sql);
		await executor.execute(stmt.sql);
	}
}

/**
 * drizzle-kit 出力 SQL テキストを変換して DSQL へ適用する (transform + apply の一括版)。
 *
 * @param sqlText drizzle-kit generate の出力 migration SQL。
 * @param executor autocommit raw executor。
 */
export async function runDsqlMigration(
	sqlText: string,
	executor: RawSqlExecutor,
	opts: ApplyMigrationOptions = {},
): Promise<DsqlMigrationPlan> {
	const plan = transformDrizzleSqlToDsql(sqlText);
	await applyDsqlMigrationPlan(plan, executor, opts);
	return plan;
}
