// tests/unit/services/activity-legacy-table-write-zero.test.ts
//
// #2458-A1 regression test: 旧 `activities` table への write が 0 件であることを保証する。
//
// facade rewrite 後の sqlite/activity-repo.ts は全 write method (insertActivity /
// updateActivity / setActivityVisibility / deleteActivity / archiveActivities /
// restoreArchivedActivities) を `child_activities` 経由に切替えた。本テストは
// 1. 各 facade method を呼んでも `activities` table の row count が 0 のまま
// 2. `child_activities` 側にのみ effect が現れる
// を assert する。これにより #2458-C (旧 table physical drop) が安全に実行可能。
//
// 参照:
//   - PR #2458-A1 / Issue #2458
//   - ADR-0055 §3.1 per-child primary data model

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, createTestDb, resetDb, type TestSqlite } from '../helpers/test-db';

// vitest が `$lib/server/db/client` を共有する設計のため、テスト DB を inject する
const dbHolder: { sqlite: TestSqlite | null; db: ReturnType<typeof createTestDb>['db'] | null } = {
	sqlite: null,
	db: null,
};

vi.mock('$lib/server/db/client', () => ({
	get db() {
		if (!dbHolder.db) throw new Error('test db not initialized');
		return dbHolder.db;
	},
}));

const TENANT = 't-2458-write-zero';

// import after mock
import { children as childrenTable } from '$lib/server/db/schema';
import * as activityRepo from '$lib/server/db/sqlite/activity-repo';

function countActivitiesTable(sqlite: TestSqlite): number {
	const row = sqlite.prepare('SELECT COUNT(*) as cnt FROM activities').get() as { cnt: number };
	return row.cnt;
}

function countChildActivitiesTable(sqlite: TestSqlite): number {
	const row = sqlite.prepare('SELECT COUNT(*) as cnt FROM child_activities').get() as {
		cnt: number;
	};
	return row.cnt;
}

describe('#2458-A1: 旧 activities table への write 0 件保証', () => {
	let testChildId: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;
		// child を 1 件 seed (insertActivity の fallback bind 用)
		const child = db
			.insert(childrenTable)
			.values({
				nickname: 'テスト児',
				age: 8,
				theme: 'default',
				uiMode: 'elementary',
				userId: TENANT,
			})
			.returning()
			.get();
		testChildId = child.id;
	});

	afterEach(() => {
		if (dbHolder.sqlite) {
			resetDb(dbHolder.sqlite);
			closeDb(dbHolder.sqlite);
		}
		dbHolder.sqlite = null;
		dbHolder.db = null;
	});

	it('insertActivity: 旧 activities table への write 0、child_activities に 1 件', async () => {
		if (!dbHolder.sqlite) throw new Error('sqlite not initialized');
		const beforeOld = countActivitiesTable(dbHolder.sqlite);
		const beforeNew = countChildActivitiesTable(dbHolder.sqlite);

		const result = await activityRepo.insertActivity(
			{
				name: 'たいそうした',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
				priority: 'optional',
			},
			TENANT,
		);

		expect(result).toBeDefined();
		expect(result?.name).toBe('たいそうした');
		// AC: 旧 activities table への write が発生していない
		expect(countActivitiesTable(dbHolder.sqlite)).toBe(beforeOld);
		// child_activities に 1 件追加された
		expect(countChildActivitiesTable(dbHolder.sqlite)).toBe(beforeNew + 1);
	});

	it('updateActivity: 旧 activities table への write 0', async () => {
		if (!dbHolder.sqlite) throw new Error('sqlite not initialized');
		const inserted = await activityRepo.insertActivity(
			{
				name: '更新前',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
			},
			TENANT,
		);

		const beforeOld = countActivitiesTable(dbHolder.sqlite);

		const updated = await activityRepo.updateActivity(
			inserted.id,
			{ name: '更新後', basePoints: 10 },
			TENANT,
		);

		expect(updated?.name).toBe('更新後');
		expect(updated?.basePoints).toBe(10);
		expect(countActivitiesTable(dbHolder.sqlite)).toBe(beforeOld); // 旧 table 不変
	});

	it('setActivityVisibility: 旧 activities table への write 0', async () => {
		if (!dbHolder.sqlite) throw new Error('sqlite not initialized');
		const inserted = await activityRepo.insertActivity(
			{
				name: '対象活動',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
			},
			TENANT,
		);
		const beforeOld = countActivitiesTable(dbHolder.sqlite);

		const result = await activityRepo.setActivityVisibility(inserted.id, false, TENANT);

		expect(result?.isVisible).toBe(0);
		expect(countActivitiesTable(dbHolder.sqlite)).toBe(beforeOld);
	});

	it('archiveActivities + restoreArchivedActivities: 旧 activities table への write 0', async () => {
		if (!dbHolder.sqlite) throw new Error('sqlite not initialized');
		const a = await activityRepo.insertActivity(
			{
				name: 'A',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
			},
			TENANT,
		);
		const b = await activityRepo.insertActivity(
			{
				name: 'B',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
			},
			TENANT,
		);
		const beforeOld = countActivitiesTable(dbHolder.sqlite);

		// Phase 7 PR-2a (#2688): ArchivedReason 型強制 (ARCHIVED_REASONS SSOT)
		await activityRepo.archiveActivities([a.id, b.id], 'trial_expired', TENANT);
		expect(countActivitiesTable(dbHolder.sqlite)).toBe(beforeOld);

		await activityRepo.restoreArchivedActivities('trial_expired', TENANT);
		expect(countActivitiesTable(dbHolder.sqlite)).toBe(beforeOld);
	});

	it('deleteActivity: 旧 activities table への write 0、child_activities から 1 件 delete', async () => {
		if (!dbHolder.sqlite) throw new Error('sqlite not initialized');
		const inserted = await activityRepo.insertActivity(
			{
				name: '削除対象',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
			},
			TENANT,
		);
		const beforeOld = countActivitiesTable(dbHolder.sqlite);
		const beforeNew = countChildActivitiesTable(dbHolder.sqlite);

		const deleted = await activityRepo.deleteActivity(inserted.id, TENANT);

		expect(deleted?.name).toBe('削除対象');
		expect(countActivitiesTable(dbHolder.sqlite)).toBe(beforeOld);
		expect(countChildActivitiesTable(dbHolder.sqlite)).toBe(beforeNew - 1);
	});

	it('findActivities: read もすべて child_activities から (旧 table への write も発生しない)', async () => {
		if (!dbHolder.sqlite) throw new Error('sqlite not initialized');
		await activityRepo.insertActivity(
			{
				name: 'A',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
			},
			TENANT,
		);

		const beforeOld = countActivitiesTable(dbHolder.sqlite);

		const list = await activityRepo.findActivities(TENANT, {});
		expect(list).toHaveLength(1);
		expect(list[0]?.name).toBe('A');
		// findActivities は read だが、旧 table への write が無いことも明示確認
		expect(countActivitiesTable(dbHolder.sqlite)).toBe(beforeOld);
	});

	it('insertActivity: tenant に child が 0 件なら throw する', async () => {
		if (!dbHolder.sqlite) throw new Error('sqlite not initialized');
		// child を削除
		dbHolder.sqlite.exec('DELETE FROM children');

		await expect(
			activityRepo.insertActivity(
				{
					name: '失敗',
					categoryId: 1,
					icon: '🤸',
					basePoints: 5,
					ageMin: 3,
					ageMax: 12,
					triggerHint: null,
				},
				TENANT,
			),
		).rejects.toThrow(/child が存在しない/);
	});

	// reference: testChildId は test fixture seed 用
	it('test fixture: testChildId is seeded', () => {
		expect(testChildId).toBeGreaterThan(0);
	});
});
