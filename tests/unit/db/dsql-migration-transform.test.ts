// tests/unit/db/dsql-migration-transform.test.ts
// EPIC #3424 / M4-B① カスタム migration runner — 純変換 unit test。
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 (F2)
//   実測根拠: docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 2 (#3427)
//
// 既知の drizzle-kit(pg) 出力パターン (FK 付き / USING btree / SERIAL / SEQUENCE / DML 混在) を
// 入力し、変換後 SQL が責務 1/2/4/5/6 を満たすことを assert する純変換テスト。
// (責務 3 の ASYNC build poll は dsql-migration-async-poll.test.ts / runner test で検証)。
//
// ⚠️ 過剰主張の禁止: 変換の「正しさ」は本 unit test が根拠。DSQL の実挙動 (0A000 等の
//    実 error code) は PoC 検証 2 が出典であり、PGlite は DSQL 非互換制約を強制しない
//    (PGlite での適用は「変換後が Postgres として valid」までを確認する — 下記 §PGlite)。

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { transformDrizzleSqlToDsql } from '../../../src/lib/server/db/dsql/migration/transform';

const BP = '--> statement-breakpoint';

describe('transformDrizzleSqlToDsql — 責務 1: FK 除去', () => {
	it('ALTER TABLE ADD CONSTRAINT … FOREIGN KEY 文を丸ごと除去する', () => {
		const input = [
			'CREATE TABLE "families" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL)',
			'ALTER TABLE "members" ADD CONSTRAINT "members_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;',
		].join(`;\n${BP}\n`);
		const plan = transformDrizzleSqlToDsql(input);
		expect(plan.ddl).toHaveLength(1);
		expect(plan.ddl[0]?.sql).toMatch(/CREATE TABLE "families"/);
		expect(plan.ddl.some((s) => /FOREIGN KEY/i.test(s.sql))).toBe(false);
	});

	it('inline 列レベル REFERENCES を CREATE TABLE から除去する (列定義は残す)', () => {
		const input =
			'CREATE TABLE "child_t" (\n\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,\n\t"family_id" uuid REFERENCES "families"("id") ON DELETE cascade\n)';
		const plan = transformDrizzleSqlToDsql(input);
		expect(plan.ddl).toHaveLength(1);
		expect(plan.ddl[0]?.sql).not.toMatch(/REFERENCES/i);
		expect(plan.ddl[0]?.sql).toMatch(/"family_id" uuid/);
	});

	it('表レベル FOREIGN KEY 制約行を除去し、余った comma を掃除する', () => {
		const input =
			'CREATE TABLE "members" (\n\t"id" uuid PRIMARY KEY NOT NULL,\n\t"family_id" uuid NOT NULL,\n\tCONSTRAINT "members_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade\n)';
		const plan = transformDrizzleSqlToDsql(input);
		const out = plan.ddl[0]?.sql ?? '';
		expect(out).not.toMatch(/FOREIGN KEY/i);
		expect(out).not.toMatch(/REFERENCES/i);
		// dangling comma が閉じ括弧直前に残っていないこと。
		expect(out).not.toMatch(/,\s*\)/);
		expect(out).toMatch(/"family_id" uuid NOT NULL/);
	});
});

describe('transformDrizzleSqlToDsql — 責務 2: ASYNC index 化', () => {
	it('CREATE INDEX … USING btree → CREATE INDEX ASYNC … (USING 除去)', () => {
		const plan = transformDrizzleSqlToDsql(
			'CREATE INDEX "members_family_idx" ON "members" USING btree ("family_id")',
		);
		const out = plan.ddl[0];
		if (!out) throw new Error('ddl[0] missing');
		expect(out.sql).toMatch(
			/^CREATE INDEX ASYNC "members_family_idx" ON "members" \("family_id"\)$/,
		);
		expect(out.sql).not.toMatch(/USING/i);
		expect(out.asyncIndexName).toBe('members_family_idx');
	});

	it('CREATE UNIQUE INDEX … USING btree → CREATE UNIQUE INDEX ASYNC …', () => {
		const plan = transformDrizzleSqlToDsql(
			'CREATE UNIQUE INDEX "members_uq" ON "members" USING btree ("family_id","name")',
		);
		const out = plan.ddl[0];
		if (!out) throw new Error('ddl[0] missing');
		expect(out.sql).toMatch(/^CREATE UNIQUE INDEX ASYNC "members_uq"/);
		expect(out.asyncIndexName).toBe('members_uq');
	});

	it('USING 節が無い CREATE INDEX にも ASYNC を注入する', () => {
		const plan = transformDrizzleSqlToDsql('CREATE INDEX "idx2" ON "t" ("a")');
		expect(plan.ddl[0]?.sql).toMatch(/^CREATE INDEX ASYNC "idx2"/);
		expect(plan.ddl[0]?.asyncIndexName).toBe('idx2');
	});

	it('既に ASYNC の index に二重付与しない (冪等)', () => {
		const plan = transformDrizzleSqlToDsql('CREATE INDEX ASYNC "idx3" ON "t" ("a")');
		expect(plan.ddl[0]?.sql).not.toMatch(/ASYNC\s+ASYNC/i);
		expect(plan.ddl[0]?.asyncIndexName).toBe('idx3');
	});
});

describe('transformDrizzleSqlToDsql — 責務 4/6: 文分割 / DDL⇄DML 分離', () => {
	it('breakpoint 区切りの複数文を個別 statement に分割する', () => {
		const input = [
			'CREATE TABLE "a" ("id" uuid PRIMARY KEY NOT NULL)',
			'CREATE TABLE "b" ("id" uuid PRIMARY KEY NOT NULL)',
		].join(`;\n${BP}\n`);
		const plan = transformDrizzleSqlToDsql(input);
		expect(plan.ddl).toHaveLength(2);
		// 末尾 `;` は除去される (autocommit で 1 文適用)。
		expect(plan.ddl.every((s) => !s.sql.endsWith(';'))).toBe(true);
	});

	it('INSERT/UPDATE/DELETE (seed) を dml リストへ分離する', () => {
		const input = [
			'CREATE TABLE "plans" ("code" text PRIMARY KEY NOT NULL)',
			'INSERT INTO "plans" ("code") VALUES (\'free\')',
			'UPDATE "plans" SET "code" = \'std\' WHERE "code" = \'free\'',
		].join(`;\n${BP}\n`);
		const plan = transformDrizzleSqlToDsql(input);
		expect(plan.ddl).toHaveLength(1);
		expect(plan.dml).toHaveLength(2);
		expect(plan.dml[0]?.sql).toMatch(/^INSERT INTO/);
		expect(plan.dml[1]?.sql).toMatch(/^UPDATE/);
	});
});

describe('transformDrizzleSqlToDsql — 責務 5: SERIAL/SEQUENCE 禁止', () => {
	it('SERIAL 型を含む CREATE TABLE を reject する', () => {
		expect(() =>
			transformDrizzleSqlToDsql('CREATE TABLE "serial_t" ("id" serial PRIMARY KEY NOT NULL)'),
		).toThrow(/serial/i);
	});

	it('BIGSERIAL も reject する', () => {
		expect(() =>
			transformDrizzleSqlToDsql('CREATE TABLE "t" ("id" bigserial PRIMARY KEY NOT NULL)'),
		).toThrow(/serial/i);
	});

	it('CACHE 未指定の CREATE SEQUENCE を reject する', () => {
		expect(() => transformDrizzleSqlToDsql('CREATE SEQUENCE "my_seq"')).toThrow(/CACHE/i);
	});

	it('CACHE 100 (< 65536 かつ ≠ 1) の CREATE SEQUENCE を reject する', () => {
		expect(() => transformDrizzleSqlToDsql('CREATE SEQUENCE "my_seq" CACHE 100')).toThrow(/CACHE/i);
	});

	it('CACHE 65536 / CACHE 1 の CREATE SEQUENCE は許容する', () => {
		expect(transformDrizzleSqlToDsql('CREATE SEQUENCE "s1" CACHE 65536').ddl).toHaveLength(1);
		expect(transformDrizzleSqlToDsql('CREATE SEQUENCE "s2" CACHE 1').ddl).toHaveLength(1);
	});

	// [should]1 false-positive ガード: 列名 "serial" / DEFAULT 'serial' で誤 throw しない。
	it('列名が "serial" の CREATE TABLE は誤 throw しない (型宣言でない)', () => {
		const plan = transformDrizzleSqlToDsql(
			'CREATE TABLE "t" ("id" uuid PRIMARY KEY NOT NULL, "serial" text NOT NULL)',
		);
		expect(plan.ddl).toHaveLength(1);
	});

	it("DEFAULT 'serial' 文字列を含む CREATE TABLE は誤 throw しない", () => {
		const plan = transformDrizzleSqlToDsql(
			'CREATE TABLE "t" ("id" uuid PRIMARY KEY NOT NULL, "kind" text DEFAULT \'serial\' NOT NULL)',
		);
		expect(plan.ddl).toHaveLength(1);
	});
});

describe('transformDrizzleSqlToDsql — [should] robustness', () => {
	// [should]2: 引用識別子の実名を silent 切詰めしない (poll が別 object を叩くのを防ぐ)。
	it('空白を含む引用 index 名を完全保持する', () => {
		const plan = transformDrizzleSqlToDsql('CREATE UNIQUE INDEX "members uq" ON "members" ("a")');
		expect(plan.ddl[0]?.asyncIndexName).toBe('members uq');
	});

	it('ハイフンを含む引用 index 名を完全保持する', () => {
		const plan = transformDrizzleSqlToDsql('CREATE INDEX "members-idx" ON "members" ("a")');
		expect(plan.ddl[0]?.asyncIndexName).toBe('members-idx');
	});

	// [should]3: 文字列/DEFAULT 内の REFERENCES を誤除去して DEFAULT を破壊しない。
	it("DEFAULT 'see REFERENCES parent(id)' 文字列を FK 除去で壊さない", () => {
		const input =
			'CREATE TABLE "t" (\n\t"id" uuid PRIMARY KEY NOT NULL,\n\t"note" text DEFAULT \'see REFERENCES parent(id)\' NOT NULL,\n\t"family_id" uuid REFERENCES "families"("id")\n)';
		const out = transformDrizzleSqlToDsql(input).ddl[0]?.sql ?? '';
		// 文字列内の REFERENCES は残る。列レベル inline FK (family_id) は除去される。
		expect(out).toContain("DEFAULT 'see REFERENCES parent(id)'");
		expect(out).toMatch(/"family_id" uuid\s*\)/); // inline FK 除去済
	});

	// [should]4: 非 FK の ADD CONSTRAINT ALTER の扱い。
	it('UNIQUE の ADD CONSTRAINT ALTER を CREATE UNIQUE INDEX ASYNC へ変換する', () => {
		const plan = transformDrizzleSqlToDsql(
			'ALTER TABLE "t" ADD CONSTRAINT "t_uq" UNIQUE ("a","b")',
		);
		expect(plan.ddl).toHaveLength(1);
		expect(plan.ddl[0]?.sql).toMatch(/^CREATE UNIQUE INDEX ASYNC "t_uq" ON "t" \("a","b"\)$/);
		expect(plan.ddl[0]?.asyncIndexName).toBe('t_uq');
	});

	it('PRIMARY KEY の ADD CONSTRAINT ALTER は明示 throw する (inline へ寄せるべき)', () => {
		expect(() =>
			transformDrizzleSqlToDsql('ALTER TABLE "t" ADD CONSTRAINT "t_pk" PRIMARY KEY ("id")'),
		).toThrow(/ADD CONSTRAINT/);
	});

	it('CHECK の ADD CONSTRAINT ALTER は明示 throw する', () => {
		expect(() =>
			transformDrizzleSqlToDsql('ALTER TABLE "t" ADD CONSTRAINT "t_ck" CHECK ("n" > 0)'),
		).toThrow(/ADD CONSTRAINT/);
	});

	// FK 修飾 (DEFERRABLE / MATCH) 断片を孤立させず除去する。
	it('DEFERRABLE / MATCH FULL 付き表レベル FK を修飾ごと除去する', () => {
		const input =
			'CREATE TABLE "t" (\n\t"id" uuid PRIMARY KEY NOT NULL,\n\t"fid" uuid NOT NULL,\n\tCONSTRAINT "t_fk" FOREIGN KEY ("fid") REFERENCES "f"("id") MATCH FULL ON DELETE cascade DEFERRABLE INITIALLY DEFERRED\n)';
		const out = transformDrizzleSqlToDsql(input).ddl[0]?.sql ?? '';
		expect(out).not.toMatch(/FOREIGN KEY|REFERENCES|MATCH|DEFERRABLE|INITIALLY/i);
		expect(out).not.toMatch(/,\s*\)/); // dangling comma なし
	});
});

// ── §PGlite: 変換後 SQL が「vanilla Postgres として valid」であることの確認 ──
// ⚠️ PGlite は DSQL 固有構文 (CREATE INDEX ASYNC / sys.jobs) を解さないため、ASYNC を
//    plain CREATE INDEX に戻して適用する。これは「FK 除去 + 文分割後の DDL が構文的に
//    整合し、実 Postgres エンジンで適用できる」ことの確認であり、DSQL の ASYNC/uniqueness
//    実挙動は PoC 検証 2/3 が出典 (本テストの射程外)。
describe('transformDrizzleSqlToDsql — 変換後 DDL が Postgres valid (PGlite harness)', () => {
	let client: PGlite | null = null;
	afterEach(async () => {
		await client?.close();
		client = null;
	});

	it('FK 付き drizzle-kit 出力を変換 → PGlite に適用できる (ASYNC は plain に戻して検証)', async () => {
		const input = [
			'CREATE TABLE "families" (\n\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,\n\t"name" text NOT NULL\n)',
			'CREATE TABLE "members" (\n\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,\n\t"family_id" uuid NOT NULL,\n\t"name" text NOT NULL\n)',
			'ALTER TABLE "members" ADD CONSTRAINT "members_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action',
			'CREATE INDEX "members_family_idx" ON "members" USING btree ("family_id")',
			'CREATE UNIQUE INDEX "members_uq" ON "members" USING btree ("family_id","name")',
		].join(`;\n${BP}\n`);

		const plan = transformDrizzleSqlToDsql(input);

		client = new PGlite();
		const db = drizzle(client);
		for (const stmt of plan.ddl) {
			// PGlite 用に DSQL 専用 `ASYNC` キーワードのみ落として適用 (残りは変換結果そのまま)。
			const pgliteSql = stmt.sql.replace(/\bINDEX ASYNC\b/i, 'INDEX');
			await db.execute(sql.raw(pgliteSql));
		}

		// 2 表 + 2 index が作られ、FK 制約は 0 件 (app 層 relations() 前提) であること。
		const tables = (await db.execute(
			sql.raw("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"),
		)) as { rows: Array<{ tablename: string }> };
		expect(tables.rows.map((r) => r.tablename)).toEqual(['families', 'members']);

		const fks = (await db.execute(
			sql.raw(
				"SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public'",
			),
		)) as { rows: Array<{ n: number }> };
		expect(fks.rows[0]?.n).toBe(0);

		const idx = (await db.execute(
			sql.raw(
				"SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname IN ('members_family_idx','members_uq')",
			),
		)) as { rows: Array<{ n: number }> };
		expect(idx.rows[0]?.n).toBe(2);
	});
});

describe('transformDrizzleSqlToDsql — source 順 statements (#3928)', () => {
	it('DDL→DML→DDL 混在入力の source 順を statements が保持する (ddl/dml は導出 view)', () => {
		const input = [
			'CREATE TABLE IF NOT EXISTS "old_t" ("id" uuid PRIMARY KEY NOT NULL)',
			'INSERT INTO "new_t" SELECT * FROM "old_t"',
			'DROP TABLE IF EXISTS "old_t" CASCADE',
		].join(`;\n${BP}\n`);
		const plan = transformDrizzleSqlToDsql(input);
		expect(plan.statements.map((s) => [s.kind, s.sql.split(' ')[0]])).toEqual([
			['ddl', 'CREATE'],
			['dml', 'INSERT'],
			['ddl', 'DROP'],
		]);
		// 導出 view は従来どおり分類のみ (件数整合)。
		expect(plan.ddl).toHaveLength(2);
		expect(plan.dml).toHaveLength(1);
	});
});

describe('transformDrizzleSqlToDsql — 責務 7: ADD COLUMN の列制約は fail-close (#4488)', () => {
	// 背景: 0006_redemption_quantity.sql の
	//   ALTER TABLE … ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL
	// を DSQL が 0A000 `ALTER TABLE ADD COLUMN with constraint not supported` で拒否し、
	// 統合 PR #4484 の deploy-aws-staging が落ちた。PGlite (NUC) は同じ SQL を受けるため
	// deploy-nuc-staging は緑のままで、cross-backend 非等価が DSQL 側でだけ露出する。
	//
	// DSQL の ADD COLUMN 文法は `column_name data_type [STORAGE …]` のみ (列制約を取れない)。
	// 自動分割はしない — 正しい分解に含まれる backfill は行数依存で 3,000 行/txn 上限を
	// 超えるとバッチ化が要り、純変換層が安全に生成できないため (書き手へ投げ返す)。

	it.each([
		['DEFAULT + NOT NULL', 'ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 1 NOT NULL'],
		['NOT NULL のみ', 'ADD COLUMN "c" integer NOT NULL'],
		['DEFAULT のみ', 'ADD COLUMN "c" integer DEFAULT 1'],
		['CHECK', 'ADD COLUMN "c" integer CHECK ("c" > 0)'],
		['UNIQUE', 'ADD COLUMN "c" text UNIQUE'],
		['REFERENCES', 'ADD COLUMN "c" uuid REFERENCES "other" ("id")'],
	])('%s を含む ADD COLUMN は throw する', (_label, action) => {
		expect(() => transformDrizzleSqlToDsql(`ALTER TABLE "t" ${action}`)).toThrow(
			/unsupported column constraint on ADD COLUMN/,
		);
	});

	it('素の ADD COLUMN (IF NOT EXISTS + 複数語の型) はそのまま通す', () => {
		const plan = transformDrizzleSqlToDsql(
			'ALTER TABLE "child_challenges" ADD COLUMN IF NOT EXISTS "celebration_shown_at" timestamp with time zone',
		);

		expect(plan.statements).toHaveLength(1);
		expect(plan.statements[0]?.kind).toBe('ddl');
		expect(plan.statements[0]?.sql).toContain('ADD COLUMN IF NOT EXISTS');
		// `IF NOT EXISTS` の NOT を NULL 制約と誤検出していないこと。
		expect(plan.statements[0]?.sql).toContain('timestamp with time zone');
	});

	it('列名が予約語 ("default") でも誤検出しない (識別子は構造検査から除外される)', () => {
		expect(() =>
			transformDrizzleSqlToDsql('ALTER TABLE "t" ADD COLUMN IF NOT EXISTS "default" text'),
		).not.toThrow();
	});

	it('DSQL 互換に分解した 0006 は ddl 2 文 + backfill dml 1 文になる', () => {
		const plan = transformDrizzleSqlToDsql(
			[
				'ALTER TABLE "reward_redemption_requests" ADD COLUMN IF NOT EXISTS "quantity" integer;',
				'--> statement-breakpoint',
				'ALTER TABLE "reward_redemption_requests" ALTER COLUMN "quantity" SET DEFAULT 1;',
				'--> statement-breakpoint',
				'UPDATE "reward_redemption_requests" SET "quantity" = 1 WHERE "quantity" IS NULL;',
			].join('\n'),
		);

		// runner は statements を source 順に **1 文 = 1 autocommit txn** で適用する。
		// DSQL は「DDL と DML を同一 txn に混ぜられない」ため、この分類が保たれることが要件。
		expect(plan.statements.map((s) => s.kind)).toEqual(['ddl', 'ddl', 'dml']);
		expect(plan.statements[2]?.sql).toMatch(/WHERE "quantity" IS NULL$/);
	});
});
