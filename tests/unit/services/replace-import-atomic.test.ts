// tests/unit/services/replace-import-atomic.test.ts
// #3326: 置換インポート (replace import) の原子化 (import-then-swap / recover-safe)。
//
// 本番 tenant t-82c17558 で「全削除 → 逐次投入」の非原子インポートが途中 hang し家族データ半分消失した
// 事故の根本対処。`runAtomicReplace` は backend ごとの戦略 (SQLite=BEGIN/ROLLBACK ラッパ /
// DynamoDB=backup-before-clear) で「clear + import の途中失敗時に旧データを必ず復元可能」にする。
//
// failing-test-first (ADR-0061): 途中失敗を注入し「clear 済みでも旧データが無傷」を機械再現する。
// runAtomicReplace 未実装の段階では赤、原子化実装で緑。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { clearAllFamilyData } from '../../../src/lib/server/services/data-service';
import { runAtomicReplace } from '../../../src/lib/server/services/replace-import-service';

const T = 't-atomic';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});
afterAll(() => {
	closeDb(sqlite);
});
beforeEach(() => {
	resetDb(sqlite);
});

describe('#3326 置換インポートの原子化 — 途中失敗で旧データが無傷', () => {
	it('clear 後に throw すると ROLLBACK され子供が残る (事故の故障モードを塞ぐ)', async () => {
		testDb.insert(schema.children).values({ nickname: 'のこる子', age: 8, theme: 'blue' }).run();
		testDb.insert(schema.children).values({ nickname: 'のこる子2', age: 6, theme: 'pink' }).run();
		const before = testDb.select().from(schema.children).all();
		expect(before.length).toBe(2);

		await expect(
			runAtomicReplace(T, async () => {
				// 全削除を tx 内で実行した直後に import 失敗を注入する
				await clearAllFamilyData(T);
				throw new Error('import 途中失敗注入');
			}),
		).rejects.toThrow('import 途中失敗注入');

		// ROLLBACK で clear が巻き戻り、旧データが seed 時点と完全一致する
		const after = testDb.select().from(schema.children).all();
		expect(after.length).toBe(2);
		expect(after.map((c) => c.nickname).sort()).toEqual(['のこる子', 'のこる子2']);
	});

	it('成功時は COMMIT され置換結果が確定する', async () => {
		testDb.insert(schema.children).values({ nickname: '旧', age: 8, theme: 'blue' }).run();

		const r = await runAtomicReplace(T, async () => {
			await clearAllFamilyData(T);
			testDb.insert(schema.children).values({ nickname: '新', age: 7, theme: 'green' }).run();
			return 'ok';
		});

		expect(r).toBe('ok');
		const after = testDb.select().from(schema.children).all();
		expect(after.map((c) => c.nickname)).toEqual(['新']);
	});
});
