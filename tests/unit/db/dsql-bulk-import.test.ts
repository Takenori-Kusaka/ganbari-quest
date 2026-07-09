// tests/unit/db/dsql-bulk-import.test.ts
// EPIC #3424 / M4-E item 9 (#3436) / 設計 SSOT: m3-physical-model.md §6.4 / §P5
//
// chunk saga プリミティブの契約テスト:
//   - chunkByLimits: 行数 AND byte の**両上限契約** (M4 plan §3.8 item 9 DoD)。
//     実 DSQL の 3,000 行 / 10MiB 上限自体は PoC 検証4 で実測済 (PGlite は上限を持たないため
//     本テストは「chunker が上限内の chunk しか作らない」静的契約を固定する)。
//   - runChunkedImport: マーカ同 txn による exactly-once (部分失敗 → 再実行で二重挿入なし、
//     #3436 AC2 冪等再適用) + saga 状態遷移 (in-progress → committed + マーカ掃除)。

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	chunkByLimits,
	DEFAULT_CHUNK_MAX_BYTES,
	DEFAULT_CHUNK_MAX_ROWS,
	DSQL_TXN_MAX_BYTES,
	DSQL_TXN_MAX_ROWS,
	getImportSagaState,
	runChunkedImport,
} from '../../../src/lib/server/db/dsql/bulk-import';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';
import type { TransactionRunner } from '../../../src/lib/server/db/interfaces/transaction.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000d1';

describe('chunkByLimits (両上限契約、§P5)', () => {
	const byteOf = (s: string) => s.length;

	it('[K1] 行数上限で分割する (3,001 行相当 → 全 chunk が maxRows 以下)', () => {
		const rows = Array.from({ length: 5001 }, (_, i) => `r${i}`);
		const chunks = chunkByLimits(rows, byteOf, { maxRows: 2500, maxBytes: DSQL_TXN_MAX_BYTES });
		expect(chunks.length).toBe(3); // 2500 + 2500 + 1
		for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2500);
		expect(chunks.flat()).toEqual(rows); // 順序保存 + 欠落なし
	});

	it('[K2] byte 上限で分割する (大 blob 行は少行数でも切られる)', () => {
		const rows = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)];
		const chunks = chunkByLimits(rows, byteOf, { maxRows: 3000, maxBytes: 1000 });
		expect(chunks.length).toBe(2); // 400+400 / 400
		expect(chunks[0]).toHaveLength(2);
		expect(chunks[1]).toHaveLength(1);
	});

	it('[K3] 両上限の同時契約: どの chunk も rows/bytes とも上限内 (ランダム負荷)', () => {
		let seed = 42;
		const rand = () => {
			// 決定的 LCG (Date/Math.random 非依存)
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return seed / 4294967296;
		};
		const rows = Array.from({ length: 800 }, () => 'x'.repeat(1 + Math.floor(rand() * 5000)));
		const maxRows = 100;
		const maxBytes = 50_000;
		const chunks = chunkByLimits(rows, byteOf, { maxRows, maxBytes });
		for (const c of chunks) {
			expect(c.length).toBeLessThanOrEqual(maxRows);
			expect(c.reduce((a, r) => a + r.length, 0)).toBeLessThanOrEqual(maxBytes);
		}
		expect(chunks.flat()).toEqual(rows);
	});

	it('[K4] 単一行が byte 上限超過なら即 throw (DSQL でも必ず fail するため早期検出)', () => {
		expect(() => chunkByLimits(['ok', 'x'.repeat(2000)], byteOf, { maxBytes: 1000 })).toThrow(
			/行 1 が単独で byte 上限を超過/,
		);
	});

	it('[K5] 既定予算はハード上限に対しマージンを持つ', () => {
		expect(DEFAULT_CHUNK_MAX_ROWS).toBeLessThan(DSQL_TXN_MAX_ROWS);
		expect(DEFAULT_CHUNK_MAX_BYTES).toBeLessThan(DSQL_TXN_MAX_BYTES);
		// ハード上限を超える予算指定は拒否 (上限逸脱 chunk を作れない)
		expect(() => chunkByLimits(['a'], byteOf, { maxRows: DSQL_TXN_MAX_ROWS + 1 })).toThrow();
		expect(() => chunkByLimits(['a'], byteOf, { maxBytes: DSQL_TXN_MAX_BYTES + 1 })).toThrow();
	});
});

describe('runChunkedImport (saga + exactly-once、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let runner: TransactionRunner<SqlExecutor>;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	/** 検証用 statement builder: settings に data 行を書く (行数検証が容易な最小資材)。 */
	const insertDataRows = (prefix: string) => (chunk: readonly string[]) =>
		chunk.map(
			(row) => sql`
				INSERT INTO settings (family_id, key, value)
				VALUES (${FAMILY}, ${`${prefix}:${row}`}, 'v')
			`,
		);

	const countDataRows = async (prefix: string): Promise<number> => {
		const r = await t.db.execute(sql`
			SELECT count(*) AS c FROM settings
			WHERE family_id = ${FAMILY} AND key LIKE ${`${prefix}:%`}
		`);
		return Number((r.rows[0] as { c: unknown }).c);
	};

	it('[S1] 全 chunk 成功: 全行適用 + committed + マーカ掃除', async () => {
		const rows = Array.from({ length: 10 }, (_, i) => `s1-${i}`);
		const chunks = chunkByLimits(rows, (r) => r.length, { maxRows: 4 });
		const result = await runChunkedImport({
			db: t.db,
			runner,
			tenantId: FAMILY,
			batchId: 'batch-s1',
			chunks,
			buildChunkStatements: insertDataRows('data-s1'),
		});
		expect(result).toEqual({ appliedChunks: 3, skippedChunks: 0 });
		expect(await countDataRows('data-s1')).toBe(10);
		expect(await getImportSagaState(t.db, FAMILY, 'batch-s1')).toBe('committed');
		// chunk マーカは掃除済み
		const markers = await t.db.execute(sql`
			SELECT count(*) AS c FROM settings
			WHERE family_id = ${FAMILY} AND key LIKE ${'import-saga:batch-s1:chunk:%'}
		`);
		expect(Number((markers.rows[0] as { c: unknown }).c)).toBe(0);
	});

	it('[S2] 部分失敗 → 再実行で冪等再適用 (二重挿入なし、#3436 AC2)', async () => {
		const rows = Array.from({ length: 12 }, (_, i) => `s2-${i}`);
		const chunks = chunkByLimits(rows, (r) => r.length, { maxRows: 3 }); // 4 chunks
		const apply = insertDataRows('data-s2');

		// 1 回目: chunk 2 で故障注入 → reject
		await expect(
			runChunkedImport({
				db: t.db,
				runner,
				tenantId: FAMILY,
				batchId: 'batch-s2',
				chunks,
				buildChunkStatements: (chunk, i) => {
					if (i === 2) throw new Error('injected failure');
					return apply(chunk);
				},
			}),
		).rejects.toThrow('injected failure');

		// chunk 0,1 のみ適用 (chunk 2 は行 + マーカとも rollback = 同 txn 原子性)
		expect(await countDataRows('data-s2')).toBe(6);
		expect(await getImportSagaState(t.db, FAMILY, 'batch-s2')).toBe('in-progress');

		// 2 回目 (同一 batchId + 同一 chunking): 0,1 は skip、2,3 のみ適用
		const result = await runChunkedImport({
			db: t.db,
			runner,
			tenantId: FAMILY,
			batchId: 'batch-s2',
			chunks,
			buildChunkStatements: apply,
		});
		expect(result).toEqual({ appliedChunks: 2, skippedChunks: 2 });
		expect(await countDataRows('data-s2')).toBe(12); // 二重挿入なし
		expect(await getImportSagaState(t.db, FAMILY, 'batch-s2')).toBe('committed');
	});

	it('[S3] §P9 tenant 分離: マーカ / saga 状態は family スコープ', async () => {
		const OTHER = '00000000-0000-4000-8000-0000000000d2';
		await runChunkedImport({
			db: t.db,
			runner,
			tenantId: FAMILY,
			batchId: 'batch-s3',
			chunks: [['a']],
			buildChunkStatements: insertDataRows('data-s3'),
		});
		expect(await getImportSagaState(t.db, FAMILY, 'batch-s3')).toBe('committed');
		expect(await getImportSagaState(t.db, OTHER, 'batch-s3')).toBeUndefined();
	});
});
