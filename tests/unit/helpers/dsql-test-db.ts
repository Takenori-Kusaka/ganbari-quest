// tests/unit/helpers/dsql-test-db.ts
// DSQL repo テスト用の PGlite in-memory DB helper (#3424 PR-R1)。
//
// **実 schema (src/lib/server/db/dsql/schema.ts) を drizzle-kit/api の pushSchema で
// そのまま適用**する。手書き CREATE TABLE fixture の二重管理 (schema drift の温床) を排除し、
// fitness#9/#6/#13 が検証している唯一の DDL SSOT でテストする。
// 全 45 表が適用されるため、多表に跨る操作 (deleteChild の集約削除等) もそのまま検証できる。
//
// ⚠️ PGlite は単一接続: tx 内で tx 外 db を await すると deadlock する
// (dsql-run-in-transaction.test.ts の知見)。escape 再現は fire→settle で行うこと。

import { PGlite } from '@electric-sql/pglite';
import { pushSchema } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/pglite';
import * as dsqlSchema from '../../../src/lib/server/db/dsql/schema';

export type DsqlTestDb = Awaited<ReturnType<typeof createDsqlTestDb>>;

/** 実 dsql schema を適用済みの PGlite DB を作る。afterAll で close() すること。 */
export async function createDsqlTestDb() {
	const client = new PGlite();
	const db = drizzle(client);
	// pushSchema は空 DB との diff = 全 CREATE を生成して適用する。
	// biome-ignore lint/suspicious/noExplicitAny: drizzle-kit/api の型が drizzle 本体と別系列のため
	const { apply } = await pushSchema(dsqlSchema as any, db as any);
	await apply();
	return {
		db,
		client,
		close: () => client.close(),
	};
}
