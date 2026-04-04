// tests/unit/services/data-service.test.ts
// テナントデータクリア・サマリーサービスのユニットテスト
// data-service.ts はファクトリ経由（getRepos()）でDBアクセスするため、
// ファクトリをモックしてテストする。

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockDeleteChildFiles = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	deleteChildFiles: (...args: unknown[]) => mockDeleteChildFiles(...args),
}));

// ファクトリをモック — テスト用SQLiteのchild-repoメソッドを提供
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: {
			findAllChildren: async (_tenantId: string) => {
				return testDb.select().from(schema.children).all();
			},
			deleteChild: async (id: number, _tenantId: string) => {
				// SQLite child-repo と同等のカスケード削除
				testDb
					.delete(schema.checklistOverrides)
					.where(eq(schema.checklistOverrides.childId, id))
					.run();
				testDb.delete(schema.checklistLogs).where(eq(schema.checklistLogs.childId, id)).run();
				testDb.delete(schema.specialRewards).where(eq(schema.specialRewards.childId, id)).run();
				testDb
					.delete(schema.childAchievements)
					.where(eq(schema.childAchievements.childId, id))
					.run();
				testDb.delete(schema.loginBonuses).where(eq(schema.loginBonuses.childId, id)).run();
				testDb.delete(schema.characterImages).where(eq(schema.characterImages.childId, id)).run();
				testDb.delete(schema.evaluations).where(eq(schema.evaluations.childId, id)).run();
				testDb.delete(schema.statusHistory).where(eq(schema.statusHistory.childId, id)).run();
				testDb.delete(schema.statuses).where(eq(schema.statuses.childId, id)).run();
				testDb.delete(schema.pointLedger).where(eq(schema.pointLedger.childId, id)).run();
				testDb.delete(schema.activityLogs).where(eq(schema.activityLogs.childId, id)).run();
				testDb
					.delete(schema.stampEntries)
					.where(
						eq(
							schema.stampEntries.cardId,
							testDb
								.select({ id: schema.stampCards.id })
								.from(schema.stampCards)
								.where(eq(schema.stampCards.childId, id))
								.get()?.id ?? -1,
						),
					)
					.run();
				testDb.delete(schema.stampCards).where(eq(schema.stampCards.childId, id)).run();
				testDb.delete(schema.children).where(eq(schema.children.id, id)).run();
			},
		},
	}),
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
		expect(summary.loginBonuses).toBe(0);
		expect(summary.checklistTemplates).toBe(0);
		expect(summary.voices).toBe(0);
	});

	it('子供あり → children のみ正確にカウント', async () => {
		testDb
			.insert(schema.children)
			.values([
				{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'kinder' },
				{ nickname: '花子', age: 3, theme: 'pink', uiMode: 'baby' },
			])
			.run();

		const summary = await getDataSummary(TENANT);
		expect(summary.children).toBe(2);
		// ファクトリベースの実装では children 以外は 0
		// (Phase 2 で on-demand カウントに移行予定: #0291)
		expect(summary.activityLogs).toBe(0);
		expect(summary.pointLedger).toBe(0);
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

	it('データあり → 子供が全件削除される', async () => {
		testDb
			.insert(schema.children)
			.values([{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'kinder' }])
			.run();

		testDb
			.insert(schema.pointLedger)
			.values([
				{ childId: 1, amount: 10, type: 'activity', description: 'テスト' },
				{ childId: 1, amount: 20, type: 'bonus', description: 'ボーナス' },
			])
			.run();

		const result = await clearAllFamilyData(TENANT);
		expect(result.deleted.children).toBe(1);

		// 削除後にサマリー確認 — 子供が0になっている
		const summary = await getDataSummary(TENANT);
		expect(summary.children).toBe(0);

		// カスケード削除により関連データも消えている
		const remainingPoints = testDb.select().from(schema.pointLedger).all();
		expect(remainingPoints.length).toBe(0);
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

	it('関連テーブルがカスケード削除される', async () => {
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

		// カスケード削除の検証 — 関連テーブルも空になっている
		expect(testDb.select().from(schema.statuses).all().length).toBe(0);
		expect(testDb.select().from(schema.stampCards).all().length).toBe(0);
	});
});
