// tests/unit/services/migration-batch-service.test.ts
// バッチマイグレーションサービスのユニットテスト

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

import {
	getMigrationStats,
	runAllBatchMigrations,
	runBatchMigration,
} from '$lib/server/db/migration/batch';

beforeAll(() => {
	const result = createTestDb();
	sqlite = result.sqlite;
	testDb = result.db;
});

afterAll(() => closeDb(sqlite));

beforeEach(() => {
	resetDb(sqlite);
});

const childRow = (
	overrides: Partial<{ id: number; nickname: string; age: number; _sv: number | null }> = {},
) => ({
	nickname: 'テスト',
	age: 5,
	theme: 'blue',
	uiMode: 'kinder',
	...overrides,
});

describe('getMigrationStats', () => {
	it('空のDBでも統計が返る', () => {
		const stats = getMigrationStats();
		expect(stats.length).toBeGreaterThanOrEqual(2);
		for (const s of stats) {
			expect(s.totalRecords).toBe(0);
			expect(s.needsMigration).toBe(0);
		}
	});

	it('_sv=NULL のレコードをneedsMigrationとして検出', () => {
		testDb
			.insert(schema.children)
			.values(childRow({ _sv: null }))
			.run();

		const stats = getMigrationStats();
		const childStats = stats.find((s) => s.entityType === 'child');
		expect(childStats).toBeDefined();
		expect(childStats?.totalRecords).toBe(1);
		expect(childStats?.needsMigration).toBe(1);
		expect(childStats?.upToDate).toBe(0);
	});

	it('最新バージョンのレコードはupToDate', () => {
		testDb
			.insert(schema.children)
			.values(childRow({ _sv: 2 }))
			.run();

		const stats = getMigrationStats();
		const childStats = stats.find((s) => s.entityType === 'child');
		expect(childStats?.totalRecords).toBe(1);
		expect(childStats?.upToDate).toBe(1);
		expect(childStats?.needsMigration).toBe(0);
	});

	it('バージョン分布が正しく集計される', () => {
		testDb
			.insert(schema.children)
			.values([
				childRow({ id: 1, nickname: 'A', _sv: null }),
				childRow({ id: 2, nickname: 'B', _sv: 1 }),
				childRow({ id: 3, nickname: 'C', _sv: 2 }),
			])
			.run();

		const stats = getMigrationStats();
		const childStats = stats.find((s) => s.entityType === 'child');
		expect(childStats?.totalRecords).toBe(3);
		expect(childStats?.needsMigration).toBe(2); // null + v1
		expect(childStats?.upToDate).toBe(1); // v2
		expect(childStats?.distribution.length).toBeGreaterThanOrEqual(2);
	});
});

describe('runBatchMigration', () => {
	it('dryRun=trueで実際の更新はしない', () => {
		testDb
			.insert(schema.children)
			.values(childRow({ _sv: null }))
			.run();

		const result = runBatchMigration('child', { dryRun: true });
		expect(result.scanned).toBe(1);
		expect(result.migrated).toBe(0);

		// DBは変更されていないことを確認
		const row = testDb.select().from(schema.children).all()[0];
		expect(row?._sv).toBeNull();
	});

	it('_sv=NULLのchildレコードをv2にマイグレーション', () => {
		testDb
			.insert(schema.children)
			.values(childRow({ _sv: null }))
			.run();

		const result = runBatchMigration('child', { dryRun: false });
		expect(result.scanned).toBe(1);
		expect(result.migrated).toBe(1);
		expect(result.failed).toBe(0);

		const row = testDb.select().from(schema.children).all()[0];
		expect(row?._sv).toBe(2);
	});

	it('_sv=1のstatusレコードをv2にマイグレーション', () => {
		testDb
			.insert(schema.children)
			.values(childRow({ id: 1, _sv: 2 }))
			.run();
		testDb
			.insert(schema.statuses)
			.values({
				childId: 1,
				categoryId: 1,
				totalXp: 100,
				level: 3,
				peakXp: 0,
				_sv: 1,
			})
			.run();

		const result = runBatchMigration('status', { dryRun: false });
		expect(result.scanned).toBe(1);
		expect(result.migrated).toBe(1);

		const row = testDb.select().from(schema.statuses).all()[0];
		expect(row?._sv).toBe(2);
		expect(row?.peakXp).toBe(100); // peakXp copied from totalXp
	});

	it('最新バージョンのレコードはスキップ', () => {
		testDb
			.insert(schema.children)
			.values(childRow({ _sv: 2 }))
			.run();

		const result = runBatchMigration('child', { dryRun: false });
		expect(result.scanned).toBe(0);
		expect(result.migrated).toBe(0);
	});

	it('limitパラメータで処理数を制限', () => {
		for (let i = 1; i <= 5; i++) {
			testDb
				.insert(schema.children)
				.values(childRow({ id: i, nickname: `テスト${i}`, _sv: null }))
				.run();
		}

		const result = runBatchMigration('child', { dryRun: false, limit: 3 });
		expect(result.scanned).toBe(3);
		expect(result.migrated).toBe(3);

		const stats = getMigrationStats();
		const childStats = stats.find((s) => s.entityType === 'child');
		expect(childStats?.needsMigration).toBe(2);
	});
});

describe('runAllBatchMigrations', () => {
	it('全エンティティタイプをまとめてマイグレーション', () => {
		testDb
			.insert(schema.children)
			.values(childRow({ id: 1, _sv: null }))
			.run();
		testDb
			.insert(schema.statuses)
			.values({
				childId: 1,
				categoryId: 1,
				totalXp: 50,
				level: 2,
				peakXp: 0,
				_sv: 1,
			})
			.run();

		const results = runAllBatchMigrations({ dryRun: false });
		expect(results.length).toBeGreaterThanOrEqual(2);

		const childResult = results.find((r) => r.entityType === 'child');
		expect(childResult?.migrated).toBe(1);

		const statusResult = results.find((r) => r.entityType === 'status');
		expect(statusResult?.migrated).toBe(1);
	});
});
