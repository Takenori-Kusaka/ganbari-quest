// tests/unit/db/probe-pg.test.ts
// #3620 AC-C5 / EPIC #3424 — pg 系 backend の health probe (probePg) の実機テスト。
//
// 背景 (staging cycle 3 の反省): 従来 /api/health は dynamodb 以外を一律 sqlite probe しており、
// DATA_SOURCE=dsql/pglite でも「空 sqlite が触れた」だけで 200 を返す偽陽性だった。probePg は
// **実 backend への実接続** (SELECT 1 + children count) で liveness + schema 実在を検証する。
//
//   [PP1] migration 適用済み PGlite に対して probePg('pglite') が schemaValid=true を返す
//   [PP2] 未 init (schema なし相当) は throw する (偽陽性で 200 を返さない)

import { afterEach, describe, expect, it } from 'vitest';
import {
	initPgliteConnection,
	resetPgliteConnectionForTesting,
} from '../../../src/lib/server/db/pglite/connection';
import { probePg } from '../../../src/lib/server/db/probe';

describe('probePg (#3620 AC-C5、実 backend 実接続 probe)', () => {
	afterEach(async () => {
		await resetPgliteConnectionForTesting();
	});

	it('[PP1] migration 適用済み PGlite: schemaValid=true (children 表 count 実行)', async () => {
		delete process.env.PGLITE_DATA_DIR; // in-memory + 実 migration 適用
		await initPgliteConnection();
		const result = await probePg('pglite');
		expect(result.schemaValid).toBe(true);
	});

	it('[PP2] 未 init: throw する (空 backend の偽陽性 200 を防ぐ)', async () => {
		await resetPgliteConnectionForTesting();
		await expect(probePg('pglite')).rejects.toThrow();
	});
});
