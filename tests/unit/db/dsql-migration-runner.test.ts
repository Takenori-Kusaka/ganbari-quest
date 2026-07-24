// tests/unit/db/dsql-migration-runner.test.ts
// EPIC #3424 / M4-B① カスタム migration runner — オーケストレーション test。
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 (F2/F3)
//
// mock executor で適用順序 (責務 4/6 + ASYNC UNIQUE build 順序 hard 制約) を検証:
//   - 各文を **source 順に 1 文ずつ autocommit で適用** (txn 一括しない、#3928)。
//   - ASYNC index の直後に poll (completed になるまで書込を開放しない)。
//   - DDL→DML→DDL 型 (0004 fold) でも source 順が保持される (#3928 回帰)。
//   - index build failed で runner が throw し以降を止める。

import { describe, expect, it } from 'vitest';
import {
	applyDsqlMigrationPlan,
	createDrizzleRawExecutor,
	type DsqlMigrationPlan,
	type RawSqlExecutor,
	runDsqlMigration,
} from '../../../src/lib/server/db/dsql/migration/runner';
import type { DsqlPlannedStatement } from '../../../src/lib/server/db/dsql/migration/transform';

const BP = '--> statement-breakpoint';

/** source 順 statements から plan を組む test helper (ddl/dml view は transform と同じ導出)。 */
function makePlan(statements: DsqlPlannedStatement[]): DsqlMigrationPlan {
	const toView = ({ kind: _kind, ...rest }: DsqlPlannedStatement) => rest;
	return {
		statements,
		ddl: statements.filter((s) => s.kind === 'ddl').map(toView),
		dml: statements.filter((s) => s.kind === 'dml').map(toView),
	};
}

/**
 * 適用文 / watermark 捕捉 / sys.jobs poll を記録する mock。
 * - `max(...) AS watermark` (watermark 捕捉) → watermarks 記録 + {watermark:null} 返却。
 * - `ORDER BY ... LIMIT 1` (poll) → polls 記録 + index ごとの status 返却。
 * - それ以外 → applied 記録 (DDL/DML 適用)。
 */
function recordingExecutor(jobStatus: Record<string, string> = {}): RawSqlExecutor & {
	applied: string[];
	polls: string[];
	watermarks: string[];
} {
	const applied: string[] = [];
	const polls: string[] = [];
	const watermarks: string[] = [];
	const objectName = (s: string) => s.match(/object_name = 'public\.(\w+)'/)?.[1] ?? '';
	return {
		applied,
		polls,
		watermarks,
		execute: async (sqlText: string) => {
			if (/AS watermark/i.test(sqlText)) {
				watermarks.push(objectName(sqlText));
				return { rows: [{ watermark: null }] };
			}
			if (/FROM sys\.jobs/i.test(sqlText)) {
				const idx = objectName(sqlText);
				polls.push(idx);
				return { rows: [{ status: jobStatus[idx] ?? 'completed' }] };
			}
			applied.push(sqlText);
			return { rows: [] };
		},
	};
}

describe('applyDsqlMigrationPlan — 適用順序', () => {
	it('DDL を 1 文ずつ適用し、ASYNC index の後に poll、その後 DML を適用する', async () => {
		const exec = recordingExecutor();
		await applyDsqlMigrationPlan(
			makePlan([
				{ sql: 'CREATE TABLE "members" (...)', kind: 'ddl' },
				{
					sql: 'CREATE UNIQUE INDEX ASYNC "members_uq" ON "members" ("a")',
					asyncIndexName: 'members_uq',
					kind: 'ddl',
				},
				{ sql: 'INSERT INTO "members" VALUES (1)', kind: 'dml' },
			]),
			exec,
		);
		// 適用は「CREATE TABLE → CREATE INDEX ASYNC → INSERT」の順 (sys.jobs poll は applied に混ざらない)。
		expect(exec.applied).toEqual([
			'CREATE TABLE "members" (...)',
			'CREATE UNIQUE INDEX ASYNC "members_uq" ON "members" ("a")',
			'INSERT INTO "members" VALUES (1)',
		]);
		// index の後に poll が 1 回走る。
		expect(exec.polls).toEqual(['members_uq']);
		// 発行前に watermark を 1 回捕捉する (今回 build 限定・fail-open 防止)。
		expect(exec.watermarks).toEqual(['members_uq']);
	});

	it('index build failed で throw し、以降の文 (DML) を適用しない', async () => {
		const exec = recordingExecutor({ bad_uq: 'failed' });
		await expect(
			applyDsqlMigrationPlan(
				makePlan([
					{ sql: 'CREATE TABLE "t" (...)', kind: 'ddl' },
					{
						sql: 'CREATE UNIQUE INDEX ASYNC "bad_uq" ON "t" ("a")',
						asyncIndexName: 'bad_uq',
						kind: 'ddl',
					},
					{ sql: 'INSERT INTO "t" VALUES (1)', kind: 'dml' },
				]),
				exec,
				{ sleep: async () => {} },
			),
		).rejects.toThrow(/FAILED/);
		// DDL 2 文は適用されたが、poll 失敗で DML は未適用。
		expect(exec.applied).toEqual([
			'CREATE TABLE "t" (...)',
			'CREATE UNIQUE INDEX ASYNC "bad_uq" ON "t" ("a")',
		]);
		expect(exec.applied.some((s) => /INSERT/.test(s))).toBe(false);
	});

	it('onStatement hook が ddl/dml phase を通知する', async () => {
		const exec = recordingExecutor();
		const seen: Array<[string, string]> = [];
		await applyDsqlMigrationPlan(
			makePlan([
				{ sql: 'CREATE TABLE "t" (...)', kind: 'ddl' },
				{ sql: 'INSERT INTO "t" VALUES (1)', kind: 'dml' },
			]),
			exec,
			{ onStatement: (phase, s) => seen.push([phase, s]) },
		);
		expect(seen).toEqual([
			['ddl', 'CREATE TABLE "t" (...)'],
			['dml', 'INSERT INTO "t" VALUES (1)'],
		]);
	});

	it('DDL→DML→DDL 型 (0004 fold 同型) を source 順のまま適用する (#3928 回帰: DDL-first 並び替え禁止)', async () => {
		const exec = recordingExecutor();
		await applyDsqlMigrationPlan(
			makePlan([
				{ sql: 'CREATE TABLE IF NOT EXISTS "old" (...)', kind: 'ddl' },
				{ sql: 'INSERT INTO "new" SELECT * FROM "old"', kind: 'dml' },
				{ sql: 'DROP TABLE IF EXISTS "old" CASCADE', kind: 'ddl' },
			]),
			exec,
		);
		// 旧実装は DDL-first で「CREATE → DROP → INSERT」となり fold が relation 不在で fail した。
		expect(exec.applied).toEqual([
			'CREATE TABLE IF NOT EXISTS "old" (...)',
			'INSERT INTO "new" SELECT * FROM "old"',
			'DROP TABLE IF EXISTS "old" CASCADE',
		]);
	});
});

describe('runDsqlMigration — transform + apply 一括', () => {
	it('drizzle-kit 出力を変換して適用し、FK は適用されず index は ASYNC 化される', async () => {
		const exec = recordingExecutor();
		const input = [
			'CREATE TABLE "members" ("id" uuid PRIMARY KEY NOT NULL, "family_id" uuid NOT NULL)',
			'ALTER TABLE "members" ADD CONSTRAINT "fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")',
			'CREATE INDEX "members_family_idx" ON "members" USING btree ("family_id")',
		].join(`;\n${BP}\n`);

		const plan = await runDsqlMigration(input, exec);

		// FK 文は適用されない。
		expect(exec.applied.some((s) => /FOREIGN KEY/i.test(s))).toBe(false);
		// index は ASYNC 化されて適用され、poll が走る。
		expect(exec.applied.some((s) => /CREATE INDEX ASYNC "members_family_idx"/.test(s))).toBe(true);
		expect(exec.polls).toEqual(['members_family_idx']);
		expect(plan.ddl).toHaveLength(2); // CREATE TABLE + ASYNC index (FK は除去済)
	});

	it('UNIQUE の ADD CONSTRAINT ALTER を ASYNC UNIQUE INDEX へ変換して適用・poll する', async () => {
		const exec = recordingExecutor();
		const input = [
			'CREATE TABLE "t" ("id" uuid PRIMARY KEY NOT NULL, "a" text NOT NULL)',
			'ALTER TABLE "t" ADD CONSTRAINT "t_a_uq" UNIQUE ("a")',
		].join(`;\n${BP}\n`);

		await runDsqlMigration(input, exec);

		expect(exec.applied.some((s) => /ALTER TABLE/i.test(s))).toBe(false);
		expect(
			exec.applied.some((s) => /CREATE UNIQUE INDEX ASYNC "t_a_uq" ON "t" \("a"\)/.test(s)),
		).toBe(true);
		expect(exec.polls).toEqual(['t_a_uq']);
	});
});

describe('createDrizzleRawExecutor', () => {
	it('db.execute(sql.raw(...)) を呼び rows を返す', async () => {
		const calls: string[] = [];
		const fakeDb = {
			execute: async (q: { queryChunks?: unknown } | unknown) => {
				// drizzle sql.raw(...) は SQL オブジェクト。ここでは呼び出しの事実のみ確認。
				calls.push('called');
				void q;
				return { rows: [{ status: 'completed' }] };
			},
		};
		const exec = createDrizzleRawExecutor(fakeDb as never);
		const res = await exec.execute('SELECT 1');
		expect(calls).toHaveLength(1);
		expect(res.rows).toEqual([{ status: 'completed' }]);
	});

	it('rows が無い driver 応答でも空配列を返す', async () => {
		const fakeDb = { execute: async () => undefined };
		const exec = createDrizzleRawExecutor(fakeDb as never);
		const res = await exec.execute('CREATE TABLE t (...)');
		expect(res.rows).toEqual([]);
	});
});
