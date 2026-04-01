// tests/unit/services/data-service.test.ts
// テナントデータクリア・サマリーサービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { type TestDb, type TestSqlite, closeDb, createTestDb, resetDb } from '../helpers/test-db';

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
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockDeleteChildFiles = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	deleteChildFiles: (...args: unknown[]) => mockDeleteChildFiles(...args),
}));

import { clearAllFamilyData, getDataSummary } from '../../../src/lib/server/services/data-service';

const TENANT = 'test-tenant';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	vi.clearAllMocks();
	mockDeleteChildFiles.mockResolvedValue(undefined);
	resetDb(sqlite);
});

// ==========================================================
// getDataSummary
// ==========================================================

describe('getDataSummary', () => {
	it('空のDB → 全てゼロ', async () => {
		const summary = await getDataSummary(TENANT);
		expect(summary.children).toBe(0);
		expect(summary.activityLogs).toBe(0);
		expect(summary.pointLedger).toBe(0);
		expect(summary.statuses).toBe(0);
		expect(summary.achievements).toBe(0);
		expect(summary.titles).toBe(0);
		expect(summary.loginBonuses).toBe(0);
		expect(summary.checklistTemplates).toBe(0);
		expect(summary.voices).toBe(0);
	});

	it('データあり → 正しいカウント', async () => {
		// 子供を追加
		testDb
			.insert(schema.children)
			.values([
				{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'kinder' },
				{ nickname: '花子', age: 3, theme: 'pink', uiMode: 'baby' },
			])
			.run();

		// ポイント台帳
		testDb
			.insert(schema.pointLedger)
			.values([
				{ childId: 1, amount: 10, type: 'activity', description: 'テスト' },
				{ childId: 1, amount: 20, type: 'bonus', description: 'ボーナス' },
				{ childId: 2, amount: 5, type: 'activity', description: 'テスト2' },
			])
			.run();

		const summary = await getDataSummary(TENANT);
		expect(summary.children).toBe(2);
		expect(summary.pointLedger).toBe(3);
	});
});

// ==========================================================
// clearAllFamilyData
// ==========================================================

describe('clearAllFamilyData', () => {
	it('空のDB → 全て0件削除', async () => {
		const result = await clearAllFamilyData(TENANT);
		expect(result.deleted.children).toBe(0);
		expect(result.deleted.activityLogs).toBe(0);
		expect(result.deleted.pointLedger).toBe(0);
	});

	it('データあり → 全件削除', async () => {
		// 子供を追加
		testDb
			.insert(schema.children)
			.values([{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'kinder' }])
			.run();

		// ポイント台帳
		testDb
			.insert(schema.pointLedger)
			.values([
				{ childId: 1, amount: 10, type: 'activity', description: 'テスト' },
				{ childId: 1, amount: 20, type: 'bonus', description: 'ボーナス' },
			])
			.run();

		const result = await clearAllFamilyData(TENANT);
		expect(result.deleted.children).toBe(1);
		expect(result.deleted.pointLedger).toBe(2);

		// 削除後にサマリー確認
		const summary = await getDataSummary(TENANT);
		expect(summary.children).toBe(0);
		expect(summary.pointLedger).toBe(0);
	});

	it('子供ごとにdeleteChildFilesが呼ばれる', async () => {
		testDb
			.insert(schema.children)
			.values([
				{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'kinder' },
				{ nickname: '花子', age: 3, theme: 'pink', uiMode: 'baby' },
			])
			.run();

		await clearAllFamilyData(TENANT);
		expect(mockDeleteChildFiles).toHaveBeenCalledTimes(2);
	});

	it('deleteChildFiles失敗 → エラーログのみで処理続行', async () => {
		testDb
			.insert(schema.children)
			.values([{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'kinder' }])
			.run();

		mockDeleteChildFiles.mockRejectedValue(new Error('file delete failed'));

		const result = await clearAllFamilyData(TENANT);
		// ファイル削除失敗でもDB削除は成功
		expect(result.deleted.children).toBe(1);
	});

	it('関連テーブルが正しい順序で削除される', async () => {
		// 子供 + スタンプカード + ステータス
		testDb
			.insert(schema.children)
			.values([{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'kinder' }])
			.run();

		testDb
			.insert(schema.statuses)
			.values([{ childId: 1, categoryId: 1, totalXp: 100, level: 2, peakXp: 100 }])
			.run();

		testDb
			.insert(schema.stampCards)
			.values([{ childId: 1, weekStart: '2026-01-01', weekEnd: '2026-01-07' }])
			.run();

		const result = await clearAllFamilyData(TENANT);
		expect(result.deleted.children).toBe(1);
		expect(result.deleted.statuses).toBe(1);
		expect(result.deleted.other).toBeGreaterThanOrEqual(1); // stampCards含む
	});
});
