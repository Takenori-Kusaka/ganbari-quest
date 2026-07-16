// src/lib/server/db/sqlite/run-in-transaction.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A) / 設計 SSOT: docs/design/dsql-data-model.md §8
//
// SQLite (NUC) backend の TransactionRunner。drizzle の sqlite transaction は同期 callback
// 必須 (Promise を返すと throw、drizzle #2275 / better-sqlite3 #1262) のため使わず、
// 生の BEGIN IMMEDIATE …COMMIT で囲む。IMMEDIATE が writer を直列化するため
// OCC retry は no-op (§8 backend dispatch。busy は busy_timeout が吸収)。
//
// ⚠️ better-sqlite3 は同期ドライバ = 単一接続。work 内に event loop を yield する await が
//    あると並行 HTTP リクエストの書込が同 txn に混入する (SQLite parity Finding 1)。
//    work の await は tx-bound call のみ (fitness#7 で AST 機械強制予定)。

import type { Database } from 'better-sqlite3';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import { assertNotNestedTransaction, runWithTransactionContext } from '../txn-nest-guard';

/**
 * SQLite 用 TransactionRunner を生成する。
 * @param sqlite BEGIN/COMMIT/ROLLBACK を発行する raw connection
 * @param txHandle work に渡す tx handle (通常は同一 connection 上の drizzle db / raw connection)
 */
export function createSqliteTransactionRunner<TTx>(
	sqlite: Database,
	txHandle: TTx,
): TransactionRunner<TTx> {
	return {
		async runInTransaction<T>(work: (tx: TTx) => Promise<T>): Promise<T> {
			// #3535: ネスト呼出は fail-loud。native の 'cannot start a transaction within a
			// transaction' より前に、原因が特定できる message で throw する (dsql 側と同一契約)。
			assertNotNestedTransaction('sqlite');
			sqlite.exec('BEGIN IMMEDIATE');
			try {
				const result = await runWithTransactionContext(() => work(txHandle));
				sqlite.exec('COMMIT');
				return result;
			} catch (err) {
				if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
				throw err;
			}
		},
	};
}
