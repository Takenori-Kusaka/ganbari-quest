// tests/unit/db/pglite-connection.test.ts
// EPIC #3620 AC-C1 (ADR-0064 案 C) 契約テスト。
//
// 本番 PGlite 接続層 (src/lib/server/db/pglite/connection.ts) が:
//   1. 生成済み migration (drizzle/pglite) を PGlite に適用して pg-core schema を用意する
//   2. その db + runner に **dsql (pg) repos を verbatim 注入**して round-trip する (dialect 税ゼロ)
//   3. timezone を UTC 固定する (DSQL parity、::timestamptz 境界の TZ ズレ防止)
// ことを検証する。これは「NUC = PGlite で pg repos を再利用」= 案 C 成立の最小証明。
//
// dataDir 未設定のため in-memory PGlite で走る (FS 永続の durability gate は AC-C3)。

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import {
	getPgliteDb,
	getPgliteTransactionRunner,
	resetPgliteConnectionForTesting,
} from '../../../src/lib/server/db/pglite/connection';

const FAMILY = '00000000-0000-4000-8000-00000000c1a1';

describe('PGlite 本番接続層 (#3620 AC-C1、ADR-0064 案 C)', () => {
	afterEach(async () => {
		await resetPgliteConnectionForTesting();
	});

	it('[C1-1] migration 適用済みの PGlite に dsql child-repo を verbatim 注入して round-trip する', async () => {
		const db = await getPgliteDb();
		const runner = await getPgliteTransactionRunner();
		// dsql (pg) repo を無改変で PGlite executor に注入 (案 C = repo 追加ゼロ)。
		const childRepo = createDsqlChildRepo(db, runner);

		const created = await childRepo.insertChild(
			{ nickname: 'ぺぐりくん', age: 8, birthDate: '2018-01-15' },
			FAMILY,
		);
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/); // gen_random_uuid() が PGlite 上で動く
		expect(created.nickname).toBe('ぺぐりくん');

		const found = await childRepo.findChildById(created.id, FAMILY);
		expect(found?.id).toBe(created.id);
		expect(found?.nickname).toBe('ぺぐりくん');
		// §P9: 他 tenant からは見えない
		const otherFamily = '00000000-0000-4000-8000-00000000c1a2';
		expect(await childRepo.findChildById(created.id, otherFamily)).toBeUndefined();
	});

	it('[C1-2] timezone は UTC 固定 (DSQL parity)', async () => {
		const db = await getPgliteDb();
		const result = await db.execute(sql`SHOW timezone`);
		const tz = (result.rows[0] as { TimeZone?: string; timezone?: string }) ?? {};
		expect(tz.TimeZone ?? tz.timezone).toBe('UTC');
	});

	it('[C1-3] init は idempotent (2 度目の getPgliteDb は同一 singleton)', async () => {
		const db1 = await getPgliteDb();
		const db2 = await getPgliteDb();
		expect(db1).toBe(db2);
	});
});
