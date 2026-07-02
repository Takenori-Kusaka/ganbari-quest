// src/lib/server/db/dsql/run-in-transaction.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A) / 設計 SSOT: docs/design/dsql-data-model.md §8 / spike#4
//
// pg (DSQL) backend の TransactionRunner。drizzle の pg transaction (非同期 callback) を
// withOccRetry でラップし、OCC 40001 時は txn 全体を再実行する (§8 backend dispatch)。
//
// ⚠️ DSQL は SAVEPOINT 非対応 (spike#4: 0A000、txn 内 1 文エラーで後続全 25P02)。
//    「optional 失敗の局所巻戻し」は不可能なので、optional (combo / mission / 通知等) を
//    core txn に入れてはならない — core commit 後の独立 best-effort にする (#N4-2)。

import type { TransactionRunner } from '../interfaces/transaction.interface';
import { type OccRetryOptions, withOccRetry } from './occ-retry';

/** drizzle pg database の transaction 部分だけを構造的に要求する (driver 非依存)。 */
export interface PgTxCapable<TTx> {
	transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}

/**
 * DSQL (pg) 用 TransactionRunner を生成する。
 * work は再実行可能であること (40001 retry で txn 全体が再実行される、§8)。
 */
export function createDsqlTransactionRunner<TTx>(
	db: PgTxCapable<TTx>,
	opts?: OccRetryOptions,
): TransactionRunner<TTx> {
	return {
		runInTransaction: <T>(work: (tx: TTx) => Promise<T>): Promise<T> =>
			withOccRetry(() => db.transaction((tx) => work(tx)), opts),
	};
}
