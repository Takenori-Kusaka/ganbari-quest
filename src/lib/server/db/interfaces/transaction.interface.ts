// src/lib/server/db/interfaces/transaction.interface.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A) / 設計 SSOT: docs/design/dsql-data-model.md §8
//
// Unit of Work port。全 write path (recordActivity / bulk import / invite 受諾) が共有する
// txn 抽象。drizzle の transaction() ヘルパは方言非互換 (sqlite = 同期 callback 必須 /
// pg = 非同期、drizzle #2275 / better-sqlite3 #1262) のため port で吸収する。
//
// work の契約 (§8、fitness#7 で AST 機械強制予定):
//   - work 内の await は tx-bound call のみ (fetch / 通知 / dynamic import / 別 db 禁止)。
//     better-sqlite3 は同期ドライバ = 単一接続ゆえ、event loop を yield する await があると
//     並行 HTTP リクエストの書込が同 txn に混入する (SQLite parity Finding 1)。
//   - work は再実行可能 (DSQL OCC 40001 retry で全体が再実行される)。冪等性の正は
//     「txn 内 re-read」(§8)。
//   - optional (combo / mission / challenge 等) を core txn に入れない (DSQL は SAVEPOINT
//     不可 spike#4、1 文エラーで後続全 25P02)。

/** txn 境界を提供する runner。TTx = backend 別の tx handle 型 (drizzle tx / better-sqlite3)。 */
export interface TransactionRunner<TTx> {
	/**
	 * work を単一 txn (all-or-nothing) で実行する。
	 * pg (DSQL): drizzle transaction + OCC 40001 bounded retry (work は再実行され得る)。
	 * sqlite: BEGIN IMMEDIATE …COMMIT (writer 直列化、retry は no-op)。
	 */
	runInTransaction<T>(work: (tx: TTx) => Promise<T>): Promise<T>;
}
