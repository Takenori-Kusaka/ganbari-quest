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
import { resetEnvForTesting } from '../../../src/lib/runtime/env';
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

	// #3628 QM follow-up: session-level SET の脱落リスクを閉じるため、UTC は DB 既定として
	// pg_database.datconfig に永続する (接続再取得/multiplexing でも新 session が UTC を継承)。
	it('[C1-4] UTC は接続レベル保証: DB 既定 timezone が pg_db_role_setting に永続する', async () => {
		const db = await getPgliteDb();
		// PG16 系は DB 既定を pg_db_role_setting (setrole=0 = DB 全体) に持つ (datconfig は撤去)。
		// 'TimeZone=UTC' が入っている = 接続再取得/multiplexing でも新 session の既定として脱落しない。
		const result = await db.execute(
			sql`SELECT unnest(setconfig) AS cfg FROM pg_db_role_setting
				WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
					AND setrole = 0`,
		);
		const configs = (result.rows as { cfg: string }[]).map((r) => r.cfg);
		expect(configs).toContain('TimeZone=UTC');
	});

	// #3620 QM residual #2 (security guardrail): aws-prod (cloud Lambda) では PGlite を開かせない。
	// DATA_SOURCE=pglite の誤配布で全 tenant が単一 local store に集約され ADR-0063 の tenant 分離が
	// 消失する config-only blast radius を、PGlite を開く唯一の chokepoint で fail-loud に閉じる。
	it('[C1-5] aws-prod では initPgliteConnection が throw する (ADR-0063 tenant 分離 guardrail)', async () => {
		const prev = process.env.AWS_LAMBDA_FUNCTION_NAME;
		const restoreEnv = () => {
			if (prev === undefined) {
				delete process.env.AWS_LAMBDA_FUNCTION_NAME;
			} else {
				process.env.AWS_LAMBDA_FUNCTION_NAME = prev;
			}
			resetEnvForTesting();
		};
		process.env.AWS_LAMBDA_FUNCTION_NAME = 'ganbari-quest-app';
		resetEnvForTesting();
		try {
			await expect(getPgliteDb()).rejects.toThrow(/forbidden on aws-prod/);
			// self-heal (#3630): reject 後も singleton は brick されず、env 修正後は再 init できる。
			restoreEnv();
			const db = await getPgliteDb();
			expect(db).toBeTruthy();
		} finally {
			restoreEnv();
		}
	});
});
