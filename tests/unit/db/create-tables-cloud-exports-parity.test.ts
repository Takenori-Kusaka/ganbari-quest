// tests/unit/db/create-tables-cloud-exports-parity.test.ts
//
// #3572 tech-01: cloud_exports の DDL SSOT 3 者 (create-tables.ts / schema.ts /
// tests/unit/helpers/test-db.ts) のうち create-tables.ts だけ build_started_at 列が
// 欠落していた drift の回帰テスト。
//
// validateAndMigrate (schema.ts 差分検出) が nullable 列を自己修復するため実害は
// なかったが、fresh install の DDL が SSOT と揃わない状態を機械 lock する
// (ADR-0061 same-class-N→guard: #3504 status/failure_reason → #3509 build_started_at
// と同 class の「schema.ts 追加時の create-tables 同期漏れ」が 2 回発生)。
//
// 検証方法: SQL_CREATE_TABLES だけで作った fresh DB の cloud_exports 実列集合が、
// drizzle schema.ts (getTableColumns) の宣言列集合と完全一致すること。

import Database from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SQL_CREATE_TABLES } from '$lib/server/db/create-tables';
import { cloudExports } from '$lib/server/db/schema';

describe('cloud_exports DDL parity (create-tables.ts ⇔ schema.ts)', () => {
	it('SQL_CREATE_TABLES の fresh DB が schema.ts 宣言列を全て含む (build_started_at 欠落回帰 #3572 tech-01)', () => {
		const db = new Database(':memory:');
		try {
			db.exec(SQL_CREATE_TABLES);
			const actual = new Set(
				(db.prepare('PRAGMA table_info(cloud_exports)').all() as Array<{ name: string }>).map(
					(c) => c.name,
				),
			);
			const expected = Object.values(getTableColumns(cloudExports)).map((c) => c.name);

			// schema.ts の全列が create-tables.ts DDL に存在する (欠落 = validateAndMigrate
			// 頼みの自己修復 drift。SSOT 同期漏れとして fail させる)
			for (const name of expected) {
				expect(actual.has(name), `cloud_exports.${name} が create-tables.ts に欠落`).toBe(true);
			}
			// 逆方向: create-tables.ts にだけある残骸列も許さない (完全一致)
			expect([...actual].sort()).toEqual([...expected].sort());
		} finally {
			db.close();
		}
	});
});
