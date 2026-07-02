// tests/unit/db/dsql-run-in-transaction.test.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A) / 設計 SSOT: docs/design/dsql-data-model.md §8 / §13.1(fitness#7,#8) / spike#4,#8
//
// txn 基盤プリミティブ (全 write path が共有する Unit of Work):
//   - runInTransaction(work): pg = drizzle transaction + withOccRetry / sqlite = BEGIN IMMEDIATE
//   - withOccRetry: SQLSTATE 40001 (DSQL OCC、adjudicator が commit 時に write-write を検出)
//     のみ bounded retry。他エラーは即 rethrow (business error を retry すると二重付与)。
//
// pg integration は @electric-sql/pglite (WASM Postgres、Docker 不要、issue #3531 で
// testcontainers と比較し採用)。⚠️ PGlite は単一接続のため実 DSQL (多接続) と異なり
// 「tx 内で tx 外 db を await」は deadlock する。escape 再現 (fitness#8) は fire (未 await)
// → tx reject 後 settle で行う (実測 smoke 2026-07-02)。
//
// ── Canon TDD test list ──
//   [T1] withOccRetry: 40001 transient で retry し成功
//   [T2] withOccRetry: 非 40001 は即 rethrow (retry しない)
//   [T3] withOccRetry: maxAttempts 到達で最後の 40001 を throw
//   [T4] pg: commit → 反映 / [T5] pg: work throw → all rollback (原子性)
//   [T6] pg: tx 外へ escape した op は tx rollback 後も残存 = 部分コミット再現 (fitness#8 証跡。
//        SQLite では BEGIN IMMEDIATE 単一接続が隠蔽する非対称を pg 層で観測する、ADR-0061)
//   [T7] pg: work が 40001 で 1 回失敗 → runInTransaction 内蔵 retry で成功 (再実行可能契約)
//   [T8] sqlite: BEGIN IMMEDIATE の commit / rollback 原子性
//   fitness#7 (work 内 await の AST allowlist) / fitness#8 lint (module db import ban) は
//   #3531 粒度 (2) の別 PR。

import { PGlite } from '@electric-sql/pglite';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** SQLSTATE 40001 を模した transient conflict (pg driver は .code に SQLSTATE を載せる) */
const occError = () =>
	Object.assign(new Error('OC000: change conflicts with another transaction'), { code: '40001' });

describe('#N1-1: withOccRetry (§8 OCC 40001 retry)', () => {
	it('[T1] 40001 transient で retry し成功する', async () => {
		const { withOccRetry } = await import('../../../src/lib/server/db/dsql/occ-retry');
		let calls = 0;
		const result = await withOccRetry(
			async () => {
				calls++;
				if (calls < 3) throw occError();
				return 'ok';
			},
			{ maxAttempts: 3, baseDelayMs: 1 },
		);
		expect(result).toBe('ok');
		expect(calls).toBe(3);
	});

	it('[T2] 非 40001 エラーは即 rethrow (retry しない)', async () => {
		const { withOccRetry } = await import('../../../src/lib/server/db/dsql/occ-retry');
		let calls = 0;
		await expect(
			withOccRetry(
				async () => {
					calls++;
					throw Object.assign(new Error('duplicate key'), { code: '23505' });
				},
				{ maxAttempts: 3, baseDelayMs: 1 },
			),
		).rejects.toThrow('duplicate key');
		expect(calls).toBe(1);
	});

	it('[T3] maxAttempts 到達で最後の 40001 を throw する', async () => {
		const { withOccRetry } = await import('../../../src/lib/server/db/dsql/occ-retry');
		let calls = 0;
		await expect(
			withOccRetry(
				async () => {
					calls++;
					throw occError();
				},
				{ maxAttempts: 3, baseDelayMs: 1 },
			),
		).rejects.toMatchObject({ code: '40001' });
		expect(calls).toBe(3);
	});
});

describe('#N1-1: pg runInTransaction (PGlite integration、fitness#8)', () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle>;

	beforeAll(async () => {
		client = new PGlite();
		db = drizzle(client);
		await db.execute(sql`CREATE TABLE txn_probe (id int PRIMARY KEY, v text)`);
	});
	afterAll(async () => {
		await client.close();
	});

	const rows = async () =>
		(await db.execute(sql`SELECT id, v FROM txn_probe ORDER BY id`)).rows as {
			id: number;
			v: string;
		}[];

	it('[T4] commit path: work 完了で全操作が反映される', async () => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		const runner = createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
		await runner.runInTransaction(async (tx) => {
			await tx.execute(sql`INSERT INTO txn_probe VALUES (1, 'a')`);
			await tx.execute(sql`INSERT INTO txn_probe VALUES (2, 'b')`);
		});
		expect(await rows()).toEqual([
			{ id: 1, v: 'a' },
			{ id: 2, v: 'b' },
		]);
	});

	it('[T5] rollback path: work throw で全操作が巻き戻る (all-or-nothing)', async () => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		const runner = createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
		await expect(
			runner.runInTransaction(async (tx) => {
				await tx.execute(sql`INSERT INTO txn_probe VALUES (10, 'x')`);
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
		expect((await rows()).map((r) => r.id)).not.toContain(10);
	});

	it('[T6] fitness#8 証跡: tx 外へ escape した操作は tx rollback 後も残存する (部分コミット)', async () => {
		// SQLite (単一接続 BEGIN IMMEDIATE) では構造的に観測不能な「E2E 緑で本番崩壊」の
		// 非対称を pg 層で再現する (ADR-0061 push-down-pyramid)。write-path repo が tx を
		// 受け取らず module db を使うとこうなる → fitness#8 lint (別 PR) で静的にも禁止する。
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		const runner = createDsqlTransactionRunner(db, { maxAttempts: 1, baseDelayMs: 1 });
		let escaped: Promise<unknown> | undefined;
		await expect(
			runner.runInTransaction(async (tx) => {
				await tx.execute(sql`INSERT INTO txn_probe VALUES (20, 'in-tx')`);
				// escape: tx でなく module db へ。PGlite は単一接続ゆえ await すると deadlock
				// するため fire のみ (実 DSQL は別接続で即実行される、spike#8)。
				escaped = db.execute(sql`INSERT INTO txn_probe VALUES (21, 'escaped')`);
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
		await escaped;
		const ids = (await rows()).map((r) => r.id);
		expect(ids, 'tx 内操作は rollback').not.toContain(20);
		expect(ids, 'escape した操作は commit されてしまう (=部分コミットの実証)').toContain(21);
	});

	it('[T7] 40001 で 1 回失敗する work が内蔵 retry で成功する (work は再実行可能契約)', async () => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		const runner = createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
		let attempts = 0;
		await runner.runInTransaction(async (tx) => {
			attempts++;
			await tx.execute(sql`INSERT INTO txn_probe VALUES (30, 'retried')`);
			if (attempts === 1) throw occError(); // adjudicator の commit 時競合を模擬
		});
		expect(attempts).toBe(2);
		const inserted = (await rows()).filter((r) => r.id === 30);
		expect(inserted, '成功した 1 txn 分だけ反映 (retry 前の分は rollback 済)').toHaveLength(1);
	});
});

describe('#N1-1: sqlite runInTransaction (BEGIN IMMEDIATE)', () => {
	it('[T8] commit / rollback の原子性 (writer 直列化は IMMEDIATE が担い retry は no-op)', async () => {
		const { createSqliteTransactionRunner } = await import(
			'../../../src/lib/server/db/sqlite/run-in-transaction'
		);
		const sqlite = new Database(':memory:');
		sqlite.exec('CREATE TABLE txn_probe (id INTEGER PRIMARY KEY, v TEXT)');
		const runner = createSqliteTransactionRunner(sqlite, sqlite);

		await runner.runInTransaction(async (tx) => {
			tx.prepare('INSERT INTO txn_probe VALUES (1, ?)').run('a');
		});
		await expect(
			runner.runInTransaction(async (tx) => {
				tx.prepare('INSERT INTO txn_probe VALUES (2, ?)').run('b');
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		const ids = sqlite
			.prepare('SELECT id FROM txn_probe ORDER BY id')
			.all()
			.map((r) => (r as { id: number }).id);
		expect(ids).toEqual([1]);
		expect(sqlite.inTransaction, 'rollback 後に txn が閉じている').toBe(false);
		sqlite.close();
	});
});
