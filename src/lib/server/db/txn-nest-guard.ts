// src/lib/server/db/txn-nest-guard.ts
// #3535: runInTransaction のネスト呼出を fail-loud で禁止する共有 guard。
//
// 背景 (設計判断 = 「合流」ではなく「禁止」):
//   - DSQL は SAVEPOINT 非対応 (spike#4: 0A000) — ネストの局所巻戻しは原理的に不可能。
//   - dsql runner の OCC retry は「txn 全体の再実行」契約 (§8)。ネスト内側だけ retry すると
//     abort 済み外側 txn の中で再実行する無効な状態になる。
//   - drizzle の `db.transaction` を txn 内で呼ぶと **別接続の独立 txn** が作られ、外側の
//     未 commit write が見えない stale read / pool 枯渇の温床になる (SQL の NESTED ではない)。
//   - sqlite runner は `BEGIN IMMEDIATE` の native error で落ちるが文言が不明瞭。
//   fitness#7 (txn work 内は tx-bound await のみ、helper 閉包禁止) の設計意図とも一貫して、
//   ネストは呼び出し構造の欠陥として即 throw で顕在化させる。
//
// AsyncLocalStorage で「runInTransaction の work 実行中」を追跡する。process 内の全 runner
// (dsql / pglite = createDsqlTransactionRunner 共用 / sqlite) が本 guard を共有するため、
// backend を跨いだネスト (通常起きないが factory 誤配線等) も検出する。

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * txn work の進行状態。ALS context は work 内で spawn された fire-and-forget promise の
 * async chain にも**外側 txn 完了後まで**伝播する (継続作成時に bind される) ため、
 * boolean でなく mutable な done flag を持つ:
 *   - done=false (work 実行中) のネスト呼出 → 真のネスト。fail-loud に throw
 *   - done=true (外側 txn 完了後、spawn された子孫 chain からの呼出) → 独立 txn として許容
 *     (#N4-2 の「core commit 後の独立 best-effort」を async 子孫から行う正当パターンを殺さない)
 */
interface TxnContext {
	done: boolean;
}

const inTransaction = new AsyncLocalStorage<TxnContext>();

/**
 * runInTransaction 冒頭で呼ぶ。**進行中の** txn work の中なら fail-loud に throw する。
 * @param backend エラーメッセージ用の backend 識別子 ('dsql' | 'sqlite' 等)
 */
export function assertNotNestedTransaction(backend: string): void {
	const ctx = inTransaction.getStore();
	if (ctx && !ctx.done) {
		throw new Error(
			`[run-in-transaction] ネスト呼出を検出しました (backend=${backend})。` +
				'DSQL は SAVEPOINT 非対応で OCC retry は txn 全体再実行が契約のため、' +
				'runInTransaction を txn work の中から呼んではならない (#3535)。' +
				'外側の tx handle を引き回すか、呼び出し構造を単一 txn に組み直すこと。',
		);
	}
}

/** work を「txn 実行中」context で走らせる (runInTransaction 内部専用)。 */
export async function runWithTransactionContext<T>(fn: () => Promise<T>): Promise<T> {
	const ctx: TxnContext = { done: false };
	try {
		return await inTransaction.run(ctx, fn);
	} finally {
		// commit / rollback を問わず work 終了で done 化。以後、work 内から spawn された
		// async 子孫 chain の runInTransaction は独立 txn として通る (false-positive 防止)。
		ctx.done = true;
	}
}
