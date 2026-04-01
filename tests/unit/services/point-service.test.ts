// tests/unit/services/point-service.test.ts
// ポイント管理サービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import {
	type TestDb,
	type TestSqlite,
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
} from '../helpers/test-db';

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

import {
	convertPoints,
	getPointBalance,
	getPointHistory,
} from '../../../src/lib/server/services/point-service';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function resetDb() {
	resetAllTables(sqlite);
}

function seedChild() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

function addPoints(childId: number, amount: number, type: string, description: string) {
	testDb.insert(schema.pointLedger).values({ childId, amount, type, description }).run();
}

describe('point-service', () => {
	beforeEach(() => {
		seedChild();
	});

	// 残高取得
	it('ポイント残高0を返す（初期状態）', async () => {
		const result = assertSuccess(await getPointBalance(1, 'test-tenant'));
		expect(result.balance).toBe(0);
		expect(result.convertableAmount).toBe(0);
	});

	it('ポイント残高を正しく計算する', async () => {
		addPoints(1, 100, 'activity', 'テスト活動');
		addPoints(1, 200, 'activity', 'テスト活動2');
		addPoints(1, -50, 'cancel', 'キャンセル');

		const result = assertSuccess(await getPointBalance(1, 'test-tenant'));
		expect(result.balance).toBe(250);
		expect(result.convertableAmount).toBe(0); // 500未満
	});

	it('変換可能額を正しく計算する（500P単位）', async () => {
		addPoints(1, 1250, 'activity', '大量ポイント');

		const result = assertSuccess(await getPointBalance(1, 'test-tenant'));
		expect(result.balance).toBe(1250);
		expect(result.convertableAmount).toBe(1000); // 500 * 2
	});

	it('存在しない子供のポイント残高はNOT_FOUND', async () => {
		const result = await getPointBalance(999, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// 履歴取得
	it('ポイント履歴を取得する', async () => {
		addPoints(1, 100, 'activity', '活動1');
		addPoints(1, 200, 'activity', '活動2');
		addPoints(1, 50, 'login_bonus', 'ログインボーナス');

		const result = assertSuccess(await getPointHistory(1, { limit: 50, offset: 0 }, 'test-tenant'));
		const history = await result.history;
		expect(history.length).toBe(3);
	});

	it('履歴のlimit/offsetが動作する', async () => {
		addPoints(1, 10, 'activity', '1');
		addPoints(1, 20, 'activity', '2');
		addPoints(1, 30, 'activity', '3');

		const result = assertSuccess(await getPointHistory(1, { limit: 2, offset: 0 }, 'test-tenant'));
		const history = await result.history;
		expect(history.length).toBe(2);
	});

	it('存在しない子供の履歴はNOT_FOUND', async () => {
		const result = await getPointHistory(999, { limit: 50, offset: 0 }, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// ポイント変換
	it('ポイントを正常に変換できる（500P）', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(1, 500, 'test-tenant', 'preset'));
		expect(result.convertedAmount).toBe(500);
		expect(result.remainingBalance).toBe(200);

		// 残高確認
		const balance = assertSuccess(await getPointBalance(1, 'test-tenant'));
		expect(balance.balance).toBe(200);
	});

	it('残高不足時はINSUFFICIENT_POINTSエラー', async () => {
		addPoints(1, 300, 'activity', 'テスト');

		const result = await convertPoints(1, 500, 'test-tenant', 'preset');
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
	});

	it('存在しない子供の変換はNOT_FOUND', async () => {
		const result = await convertPoints(999, 500, 'test-tenant', 'preset');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('1000P変換が正常に動作する', async () => {
		addPoints(1, 1500, 'activity', '大量');

		const result = assertSuccess(await convertPoints(1, 1000, 'test-tenant', 'preset'));
		expect(result.convertedAmount).toBe(1000);
		expect(result.remainingBalance).toBe(500);
	});

	it('変換後に履歴にconvertエントリが追加される', async () => {
		addPoints(1, 600, 'activity', 'テスト');
		await convertPoints(1, 500, 'test-tenant', 'preset');

		const historyResult = assertSuccess(
			await getPointHistory(1, { limit: 50, offset: 0 }, 'test-tenant'),
		);
		const historyList = await historyResult.history;
		const convertEntry = historyList.find((h: { type: string }) => h.type === 'convert');
		expect(convertEntry).toBeDefined();
		expect(convertEntry?.amount).toBe(-500);
	});

	// 自由入力モード
	it('手動入力モードで1P単位の変換ができる', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(1, 123, 'test-tenant', 'manual'));
		expect(result.convertedAmount).toBe(123);
		expect(result.remainingBalance).toBe(577);
		expect(result.message).toContain('手動入力');
	});

	it('領収書モードで変換できる', async () => {
		addPoints(1, 1000, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(1, 648, 'test-tenant', 'receipt'));
		expect(result.convertedAmount).toBe(648);
		expect(result.remainingBalance).toBe(352);
		expect(result.message).toContain('領収書読み取り');
	});

	it('プリセットモード（デフォルト）の説明文にサフィックスがない', async () => {
		addPoints(1, 600, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(1, 500, 'test-tenant', 'preset'));
		expect(result.message).not.toContain('手動入力');
		expect(result.message).not.toContain('領収書');
	});
});
