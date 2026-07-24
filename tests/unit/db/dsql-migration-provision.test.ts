// tests/unit/db/dsql-migration-provision.test.ts
// EPIC #3424 M5 (DoD 2) — DSQL schema provisioning orchestration (provision.ts) のテスト。
//
//   [PV1] loadMigrationFiles: journal idx 順に tag + sqlText を読む
//   [PV2] fetchAppliedTags: 管理表を作成し適用済み tag 集合を返す
//   [PV3] provisionDsqlSchema: 未適用 tag のみ適用し、成功後に applied 記録 (冪等 skip)
//   [PV4] 途中失敗: 失敗 tag は applied 記録されず throw (再実行で再試行される)
//   [PV5] 実 migration SSOT 貫通: drizzle/pglite/ の実 journal + SQL が transform を通り
//         plan (ddl>0) を生成できる (dry-run 経路の実データ検証、45 表 schema の supply line)
//
// executor は fake (実行 SQL を記録) — runner の適用 semantics (autocommit / ASYNC poll) は
// dsql-migration-runner.test.ts が担保済のため、本テストは orchestration (順序 / 冪等 / 記録) に
// 限定する (重複検証しない)。

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RawSqlExecutor } from '../../../src/lib/server/db/dsql/migration/async-index-poll';
import {
	fetchAppliedTags,
	loadMigrationFiles,
	provisionDsqlSchema,
} from '../../../src/lib/server/db/dsql/migration/provision';
import { transformDrizzleSqlToDsql } from '../../../src/lib/server/db/dsql/migration/transform';

const tempDirs: string[] = [];

/** journal + sql ファイルを持つ temp migrations dir を作る。 */
function makeMigrationsDir(entries: { idx: number; tag: string; sql: string }[]): string {
	const dir = join(tmpdir(), `dsql-prov-${Date.now()}-${tempDirs.length}`);
	tempDirs.push(dir);
	mkdirSync(join(dir, 'meta'), { recursive: true });
	writeFileSync(
		join(dir, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
	);
	for (const e of entries) {
		writeFileSync(join(dir, `${e.tag}.sql`), e.sql);
	}
	return dir;
}

/** 実行 SQL を記録する fake executor。applied 管理表を素朴に再現する。 */
function makeFakeExecutor(opts: { failOn?: string; preApplied?: string[] } = {}) {
	const executed: string[] = [];
	const applied = new Set<string>(opts.preApplied ?? []);
	const executor: RawSqlExecutor = {
		execute: async (sqlText: string) => {
			executed.push(sqlText);
			if (opts.failOn && sqlText.includes(opts.failOn)) {
				throw new Error(`fake failure on: ${opts.failOn}`);
			}
			if (sqlText.startsWith('SELECT tag FROM dsql_migrations')) {
				return { rows: [...applied].map((tag) => ({ tag })) };
			}
			const insert = sqlText.match(/INSERT INTO dsql_migrations \(tag\) VALUES \('(.+)'\)/);
			if (insert?.[1]) applied.add(insert[1]);
			return { rows: [] };
		},
	};
	return { executor, executed, applied };
}

afterEach(() => {
	for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('DSQL schema provisioning (#3424 M5 DoD2、provision.ts)', () => {
	it('[PV1] loadMigrationFiles: journal idx 順に読む (journal 逆順でも昇順に整列)', () => {
		const dir = makeMigrationsDir([
			{ idx: 1, tag: '0001_second', sql: 'CREATE TABLE b (id int);' },
			{ idx: 0, tag: '0000_first', sql: 'CREATE TABLE a (id int);' },
		]);
		const files = loadMigrationFiles(dir);
		expect(files.map((f) => f.tag)).toEqual(['0000_first', '0001_second']);
		expect(files[0]?.sqlText).toContain('CREATE TABLE a');
	});

	it('[PV2] fetchAppliedTags: 管理表 DDL を発行し適用済み集合を返す', async () => {
		const { executor, executed } = makeFakeExecutor({ preApplied: ['0000_first'] });
		const tags = await fetchAppliedTags(executor);
		expect(executed[0]).toContain('CREATE TABLE IF NOT EXISTS dsql_migrations');
		expect(tags).toEqual(new Set(['0000_first']));
	});

	it('[PV3] provisionDsqlSchema: 未適用のみ適用 + applied 記録 (再実行は全 skip = 冪等)', async () => {
		const dir = makeMigrationsDir([
			{ idx: 0, tag: '0000_first', sql: 'CREATE TABLE a (id int);' },
			{ idx: 1, tag: '0001_second', sql: 'CREATE TABLE b (id int);' },
		]);
		const { executor } = makeFakeExecutor({ preApplied: ['0000_first'] });

		const first = await provisionDsqlSchema(dir, executor);
		expect(first.skipped).toEqual(['0000_first']);
		expect(first.applied.map((a) => a.tag)).toEqual(['0001_second']);

		// 再実行: 全 tag が applied 済み → 全 skip (冪等)
		const second = await provisionDsqlSchema(dir, executor);
		expect(second.skipped).toEqual(['0000_first', '0001_second']);
		expect(second.applied).toEqual([]);
	});

	it('[PV4] 途中失敗: 失敗 tag は applied 記録されず throw する (再実行で再試行可能)', async () => {
		const dir = makeMigrationsDir([
			{ idx: 0, tag: '0000_ok', sql: 'CREATE TABLE a (id int);' },
			{ idx: 1, tag: '0001_bad', sql: 'CREATE TABLE broken_table (id int);' },
		]);
		const { executor, applied } = makeFakeExecutor({ failOn: 'broken_table' });

		await expect(provisionDsqlSchema(dir, executor)).rejects.toThrow('broken_table');
		// 成功した 0000 のみ記録され、失敗した 0001 は未記録 (再実行対象のまま)
		expect(applied.has('0000_ok')).toBe(true);
		expect(applied.has('0001_bad')).toBe(false);
	});

	it('[PV5] 実 migration SSOT: drizzle/pglite の実 journal + SQL が transform を貫通し plan を生成する', () => {
		const realDir = resolve(process.cwd(), 'drizzle', 'pglite');
		const files = loadMigrationFiles(realDir);
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const plan = transformDrizzleSqlToDsql(file.sqlText);
			expect(plan.ddl.length, `${file.tag} の ddl が空`).toBeGreaterThan(0);
		}
	});

	it('[PV6] fresh provision 回帰 (#3925): 実 migration 全 tag が空 PGlite に journal 順で適用できる (prior state 仮定の混入を検出)', async () => {
		// fresh staging DSQL / 新規 NUC / DR 再構築の「空 DB に全 migration」path を実 SQL で貫通する。
		// 0004 の login_bonuses fold が fresh DB で 'table does not exist' となった class
		// (migration が既存 state を仮定する) を、以後どの migration についても機械検出する。
		const { PGlite } = await import('@electric-sql/pglite');
		const client = new PGlite();
		try {
			const realDir = resolve(process.cwd(), 'drizzle', 'pglite');
			for (const file of loadMigrationFiles(realDir)) {
				const statements = file.sqlText
					.split('--> statement-breakpoint')
					.map((s) => s.trim())
					.filter((s) => s.length > 0);
				for (const stmt of statements) {
					await expect(client.exec(stmt), `${file.tag} が fresh DB で失敗`).resolves.toBeDefined();
				}
			}
			// 終端 state: 縮約後 schema (login_streaks あり / login_bonuses なし)
			const tables = await client.query(
				`SELECT table_name FROM information_schema.tables
				 WHERE table_name IN ('login_streaks', 'login_bonuses')`,
			);
			expect(tables.rows).toEqual([{ table_name: 'login_streaks' }]);
		} finally {
			await client.close();
		}
	}, 120_000);
});

describe('DSQL pipeline fresh provision 回帰 (#3928、transform + runner 実経路)', () => {
	// #3926 は raw SQL (PGlite/NUC 経路) のみ verify し DSQL 経路 (transform の ddl/dml 分離 +
	// runner の DDL-first 適用) で fold が並び替えで fail した。本 test は **実 0003+0004 を
	// transform + runner (dsql-migrate と同一 pipeline) で適用**し、cross-backend 片側 verify の
	// 再発を封鎖する (0003/0004 は ASYNC index を含まないため PGlite で実行可能)。
	async function makePipelineExecutor() {
		const { PGlite } = await import('@electric-sql/pglite');
		const client = new PGlite();
		const executor = {
			execute: async (sqlText: string) => {
				const res = await client.query(sqlText);
				return { rows: res.rows as unknown[] };
			},
		};
		return { client, executor };
	}

	function loadRealTagSql(tag: '0003' | '0004'): string {
		const realDir = resolve(process.cwd(), 'drizzle', 'pglite');
		const file = loadMigrationFiles(realDir).find((f) => f.tag.startsWith(tag));
		if (!file) throw new Error(`tag ${tag} not found`);
		return file.sqlText;
	}

	it('[PV7] fresh DB: 実 0003→0004 が runner 経由で成功する (staging run 30079522945 の再現封鎖)', async () => {
		const { runDsqlMigration } = await import('../../../src/lib/server/db/dsql/migration/runner');
		const { client, executor } = await makePipelineExecutor();
		try {
			await runDsqlMigration(loadRealTagSql('0003'), executor);
			await runDsqlMigration(loadRealTagSql('0004'), executor);
			const tables = await client.query(
				`SELECT table_name FROM information_schema.tables
				 WHERE table_name IN ('login_streaks', 'login_bonuses')`,
			);
			expect(tables.rows).toEqual([{ table_name: 'login_streaks' }]);
		} finally {
			await client.close();
		}
	}, 60_000);

	it('[PV8] 既存 DB: seed 済 login_bonuses が runner 経由の 0004 で fold されてから DROP される (本番 data 保全)', async () => {
		const { runDsqlMigration } = await import('../../../src/lib/server/db/dsql/migration/runner');
		const { client, executor } = await makePipelineExecutor();
		try {
			await runDsqlMigration(loadRealTagSql('0003'), executor);
			// 旧 login_bonuses (0000 時点 DDL の要点列) + 3 連続日 seed
			await client.exec(`
				CREATE TABLE "login_bonuses" (
					"family_id" uuid NOT NULL,
					"child_id" uuid NOT NULL,
					"login_date" text NOT NULL,
					"created_at" timestamp with time zone DEFAULT now() NOT NULL,
					CONSTRAINT "lb_pk" PRIMARY KEY("family_id","child_id","login_date")
				);
				INSERT INTO login_bonuses (family_id, child_id, login_date) VALUES
					('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c1', '2026-07-21'),
					('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c1', '2026-07-22'),
					('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c1', '2026-07-23');
			`);
			await runDsqlMigration(loadRealTagSql('0004'), executor);
			// 旧実装 (DDL-first) は DROP が fold より先に走り data 喪失 or fail していた。
			const res = await client.query('SELECT last_login_date, current_streak FROM login_streaks');
			expect(res.rows).toEqual([{ last_login_date: '2026-07-23', current_streak: 3 }]);
		} finally {
			await client.close();
		}
	}, 60_000);
});
