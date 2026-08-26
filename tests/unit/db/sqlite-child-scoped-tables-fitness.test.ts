// tests/unit/db/sqlite-child-scoped-tables-fitness.test.ts
// #4696 — sqlite `deleteChild` の網羅性 fitness (ADR-0061 fitness function、pg 側 #3584 ① と対)。
//
// 実害: sqlite の deleteChild は 11 表しか消しておらず、`usage_logs` 等が残るため children 行の
// DELETE が FK で失敗し、しかも呼び出し側が warn で握り潰して「完了しました」と返していた。
// 「実 DB の catalog 上 child_id 列を持つ全表」== 「削除対象 SSOT (child-scoped-tables.ts) ∪ 明示特例」
// を assert することで、新表を足したときに list 更新を強制する (トートロジーにしない)。
//
// さらに [S3] は **実際に 1 人削除して全 child スコープ表から行が消える**ことを実 DB で確認する
// (list に載っていても SQL が実行されていない、を検出する)。

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CHILD_SCOPED_SPECIAL_CASE_TABLES,
	CHILD_SCOPED_TABLES_DELETE_LAST,
	SQLITE_CHILD_SCOPED_TABLES,
} from '../../../src/lib/server/db/child-scoped-tables';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let testDb: TestDb;
let sqlite: TestSqlite;

vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	getOrInitDb() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const t = createTestDb();
testDb = t.db;
sqlite = t.sqlite;

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	resetDb(sqlite);
});

/** 実 DB の catalog から child_id 列を持つ表を引く (schema.ts の regex 解析より確か)。 */
function tablesWithChildIdColumn(): string[] {
	const rows = sqlite
		.prepare(
			`SELECT m.name FROM sqlite_master m
			 JOIN pragma_table_info(m.name) p
			 WHERE m.type = 'table' AND p.name = 'child_id'
			 ORDER BY m.name`,
		)
		.all() as { name: string }[];
	return rows.map((r) => r.name);
}

describe('#4696 sqlite child スコープ表の網羅性 (deleteChild fitness)', () => {
	it('[S1] child_id 列を持つ実表がすべて削除対象 SSOT に載っている', () => {
		const actual = tablesWithChildIdColumn();
		expect(actual.length).toBeGreaterThan(20); // 走査 0 件の空振り検出
		const declared = new Set<string>(SQLITE_CHILD_SCOPED_TABLES);
		const missing = actual.filter((name) => !declared.has(name));
		expect(
			missing,
			`child_id 列を持つのに削除対象に入っていない表: ${missing.join(', ')} — src/lib/server/db/child-scoped-tables.ts に追加すること (残すと子供削除が FK で失敗する)`,
		).toEqual([]);
	});

	it('[S2] 削除対象 SSOT に実在しない表 / 特例と重複した表が無い', () => {
		const actual = new Set(tablesWithChildIdColumn());
		const stale = SQLITE_CHILD_SCOPED_TABLES.filter((name) => !actual.has(name));
		expect(
			stale,
			`実 DB に child_id 列が無いのに削除対象に載っている表: ${stale.join(', ')}`,
		).toEqual([]);
		for (const special of CHILD_SCOPED_SPECIAL_CASE_TABLES) {
			expect(SQLITE_CHILD_SCOPED_TABLES).not.toContain(special);
		}
	});

	it('[S4] 他の child スコープ表から参照される表は「最後に消す」に登録されている', () => {
		// sqlite は FK を強制するため、参照されている表を先に消すと DELETE が落ちる (#4696 で実際に発生)。
		// 実 DB の catalog から参照関係を引き、宣言と突合する (新しい FK が増えたらここで落ちる)。
		const scoped = new Set<string>(SQLITE_CHILD_SCOPED_TABLES);
		const referenced = new Set<string>();
		for (const table of SQLITE_CHILD_SCOPED_TABLES) {
			const fks = sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string }[];
			for (const fk of fks) {
				if (scoped.has(fk.table) && fk.table !== table) referenced.add(fk.table);
			}
		}
		const declared = new Set<string>(CHILD_SCOPED_TABLES_DELETE_LAST);
		const missing = [...referenced].filter((t) => !declared.has(t));
		expect(
			missing,
			`child スコープ表から参照されているのに「最後に消す」に無い表: ${missing.join(', ')} — CHILD_SCOPED_TABLES_DELETE_LAST に追加すること`,
		).toEqual([]);
	});

	it('[S3] 実際に deleteChild すると child スコープ表の行がすべて消える', async () => {
		const { insertChild, deleteChild } = await import(
			'../../../src/lib/server/db/sqlite/child-repo'
		);
		const child = await insertChild({ nickname: 'ぜんぶ消える子', age: 8 }, 't-1');
		const id = Number(child.id);

		// child スコープ表すべてに 1 行ずつ入れる (列 default に頼らず child_id のみ指定できる形で)。
		// seed 中だけ FK を切る: ここで作りたいのは「child_id を持つ行が全表にある」状態であって、
		// activity_id 等の参照先まで正しく用意することではない (削除は FK ON で検証する)。
		const fkBefore = sqlite.pragma('foreign_keys', { simple: true }) as number;
		sqlite.pragma('foreign_keys = OFF');
		const seeded: string[] = [];
		for (const table of SQLITE_CHILD_SCOPED_TABLES) {
			const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
				name: string;
				type: string;
				notnull: number;
				dflt_value: string | null;
				pk: number;
			}[];
			const required = cols.filter(
				(c) => c.notnull === 1 && c.dflt_value === null && c.pk === 0 && c.name !== 'child_id',
			);
			const names = ['child_id', ...required.map((c) => c.name)];
			const values = [id, ...required.map((c) => (/INT|REAL/i.test(c.type) ? 0 : 'x'))];
			sqlite
				.prepare(
					`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
				)
				.run(...values);
			seeded.push(table);
		}
		expect(seeded.length).toBe(SQLITE_CHILD_SCOPED_TABLES.length);
		// FK を戻してから削除する (「FK ON でも子供を消し切れる」ことがこの test の主眼)
		sqlite.pragma(`foreign_keys = ${fkBefore ? 'ON' : 'OFF'}`);

		await deleteChild(child.id, 't-1');

		for (const table of SQLITE_CHILD_SCOPED_TABLES) {
			const row = testDb.get<{ c: number }>(
				sql`SELECT count(*) AS c FROM ${sql.identifier(table)} WHERE child_id = ${id}`,
			);
			expect(row?.c, `${table} に子供の行が残っている`).toBe(0);
		}
		const remaining = testDb.get<{ c: number }>(
			sql`SELECT count(*) AS c FROM children WHERE id = ${id}`,
		);
		expect(remaining?.c).toBe(0);
	});
});
