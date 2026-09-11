// tests/unit/services/data-service.test.ts
// テナントデータクリア・サマリーサービスのユニットテスト
// data-service.ts はファクトリ経由（getRepos()）でDBアクセスするため、
// ファクトリをモックしてテストする。

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

// #4696: factory は **mock しない**。旧実装は factory を mock し、その中で child の cascade 削除を
// 手書きで再現していたため、実装 (sqlite/child-repo.ts) が 11 表しか消していない欠陥を test が
// 再現できず素通ししていた (テストが実装から乖離した典型)。db client だけを test DB に差し替え、
// **実 repo (sqlite) を通す**ことで、削除漏れがそのまま test 失敗になる。
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	getOrInitDb() {
		return testDb;
	},
}));

// request-context の invalidateRequestCaches は副作用なしにスキップ
vi.mock('$lib/server/request-context', () => ({
	invalidateRequestCaches: vi.fn(),
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
		expect(summary.loginStreaks).toBe(0);
		expect(summary.checklistTemplates).toBe(0);
		expect(summary.voices).toBe(0);
	});

	it('#4696: 子供以外も実数を返す (0 件固定にしない)', async () => {
		testDb
			.insert(schema.children)
			.values([
				{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'preschool' },
				{ nickname: '花子', age: 3, theme: 'pink', uiMode: 'baby' },
			])
			.run();
		const [taro] = testDb.select().from(schema.children).all();
		const childId = taro?.id ?? 0;
		testDb
			.insert(schema.childActivities)
			.values({ childId, name: 'はみがき', categoryId: 3, icon: '🦷', basePoints: 5 })
			.run();
		const [act] = testDb.select().from(schema.childActivities).all();
		testDb
			.insert(schema.activityLogs)
			.values([
				{ childId, activityId: act?.id ?? 0, points: 5, recordedDate: '2026-08-01' },
				{ childId, activityId: act?.id ?? 0, points: 5, recordedDate: '2026-08-02' },
			])
			.run();
		testDb
			.insert(schema.pointLedger)
			.values([
				{ childId, amount: 5, type: 'activity_record', description: 'x' },
				{ childId, amount: 5, type: 'activity_record', description: 'y' },
				{ childId, amount: -3, type: 'reward_exchange', description: 'z' },
			])
			.run();
		testDb.insert(schema.statuses).values({ childId, categoryId: 3, totalXp: 10, level: 1 }).run();
		testDb
			.insert(schema.loginStreaks)
			.values({ childId, lastLoginDate: '2026-08-02', currentStreak: 2 })
			.run();

		const summary = await getDataSummary(TENANT);
		expect(summary.children).toBe(2);
		expect(summary.activityLogs).toBe(2);
		expect(summary.pointLedger).toBe(3);
		expect(summary.statuses).toBe(1);
		expect(summary.loginStreaks).toBe(1);
	});
});

// ==========================================================
// clearAllFamilyData
// ==========================================================

describe('clearAllFamilyData', () => {
	it('空のDB → 全て0件削除', async () => {
		const result = await clearAllFamilyData(TENANT);
		expect(result.deleted.children).toBe(0);
	});

	it('データあり → 子供が全件削除される', async () => {
		testDb
			.insert(schema.children)
			.values([{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'preschool' }])
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
				{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'preschool' },
				{ nickname: '花子', age: 3, theme: 'pink', uiMode: 'baby' },
			])
			.run();

		await clearAllFamilyData(TENANT);
		expect(mockDeleteChildFiles).toHaveBeenCalledTimes(2);
	});

	it('deleteChildFiles失敗 → エラーログのみで処理続行', async () => {
		testDb
			.insert(schema.children)
			.values([{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'preschool' }])
			.run();

		mockDeleteChildFiles.mockRejectedValue(new Error('file delete failed'));

		const result = await clearAllFamilyData(TENANT);
		// ファイル削除失敗でもDB削除は成功
		expect(result.deleted.children).toBe(1);
	});

	it('関連テーブルがカスケード削除される', async () => {
		testDb
			.insert(schema.children)
			.values([{ nickname: '太郎', age: 5, theme: 'blue', uiMode: 'preschool' }])
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

	// =========================================================
	// #739: tenant-scoped data (trial_history 等) も削除される
	// =========================================================
	describe('#739 テナントスコープデータの削除', () => {
		it('deleteTenantScopedData が呼ばれ、result.deleted.other に反映される', async () => {
			const result = await clearAllFamilyData(TENANT);
			// deleteTenantScopedData は各テーブルで delete 呼び出しを行うため、
			// 「呼び出しが成立した」ことを件数で示す設計 (実データ削除の検証は下の it)
			expect(result.deleted.other).toBeGreaterThan(0);
		});

		it('#4696: tenant スコープの実データ (trial_history / settings) が実際に消える', async () => {
			// 旧 test は factory mock の spy 呼出回数だけを見ていたため、実データが消えなくても緑だった。
			testDb
				.insert(schema.trialHistory)
				.values({
					tenantId: TENANT,
					startDate: '2026-08-01',
					endDate: '2026-08-08',
					tier: 'standard',
					source: 'user_initiated',
				})
				.run();
			testDb.insert(schema.settings).values({ key: 'family_name', value: 'テスト家' }).run();

			await clearAllFamilyData(TENANT);

			expect(testDb.select().from(schema.trialHistory).all().length).toBe(0);
			expect(testDb.select().from(schema.settings).all().length).toBe(0);
		});
	});
});
