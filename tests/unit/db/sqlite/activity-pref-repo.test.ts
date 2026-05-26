// tests/unit/db/sqlite/activity-pref-repo.test.ts
//
// #2458-C-1 regression test: activity-pref-repo.countPinnedInCategory が
// `child_activities` JOIN に migrate されたことを保証する。
//
// 旧実装は legacy `activities` table と JOIN していたが、`childActivityPreferences.activityId`
// の FK target は PR-3 で `childActivities.id` に切替済 (schema.ts L564-566)。本 test は
// 1. 旧 `activities` table が空でも categoryId 集計が成立する (= 旧 table への JOIN なし)
// 2. `child_activities` の categoryId が集計対象になる (正しい JOIN target)
// 3. 別 childId / 別 categoryId / isPinned=0 は除外される
// を assert する。これにより #2458-C (旧 table physical drop) ready 状態に 1 段近づく。
//
// 参照:
//   - PR #2458-C-1 / Issue #2458
//   - PR #2487 (#2458-A1 sqlite facade rewrite — write 0 化)
//   - ADR-0055 §3.1 per-child primary data model
//   - docs/design/data-model-resource-scope.md §4.1

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, createTestDb, resetDb, type TestSqlite } from '../../helpers/test-db';

// vitest 全体で共有される client.db を test DB に差し替える
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

const TENANT = 't-2458-c1';

// import after mock
import {
	childActivities as childActivitiesTable,
	children as childrenTable,
	childActivityPreferences as prefsTable,
} from '$lib/server/db/schema';
import { countPinnedInCategory } from '$lib/server/db/sqlite/activity-pref-repo';

function countLegacyActivitiesTable(sqlite: TestSqlite): number {
	const row = sqlite.prepare('SELECT COUNT(*) as cnt FROM activities').get() as { cnt: number };
	return row.cnt;
}

describe('#2458-C-1: countPinnedInCategory は child_activities JOIN 経由', () => {
	let testChildId: number;
	let otherChildId: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;

		// child 2 件 seed
		const child1 = db
			.insert(childrenTable)
			.values({
				nickname: 'けんた',
				age: 8,
				theme: 'default',
				uiMode: 'elementary',
				userId: TENANT,
			})
			.returning()
			.get();
		testChildId = child1.id;

		const child2 = db
			.insert(childrenTable)
			.values({
				nickname: 'さくら',
				age: 6,
				theme: 'default',
				uiMode: 'elementary',
				userId: TENANT,
			})
			.returning()
			.get();
		otherChildId = child2.id;
	});

	afterEach(() => {
		if (dbHolder.sqlite) {
			resetDb(dbHolder.sqlite);
			closeDb(dbHolder.sqlite);
		}
		dbHolder.sqlite = null;
		dbHolder.db = null;
	});

	it('AC-1: 旧 activities table が空でも child_activities の categoryId 集計が成立する', async () => {
		if (!dbHolder.sqlite || !dbHolder.db) throw new Error('db not initialized');
		const db = dbHolder.db;

		// 旧 activities table は空のまま (PR-A1 で write 0 化済)
		expect(countLegacyActivitiesTable(dbHolder.sqlite)).toBe(0);

		// child_activities に categoryId=1 を 3 件 seed
		const inserted = db
			.insert(childActivitiesTable)
			.values([
				{ childId: testChildId, name: '体操', categoryId: 1, icon: '🤸', basePoints: 5 },
				{ childId: testChildId, name: 'マラソン', categoryId: 1, icon: '🏃', basePoints: 5 },
				{ childId: testChildId, name: '縄跳び', categoryId: 1, icon: '🪢', basePoints: 5 },
			])
			.returning()
			.all();

		// 3 件全てを pin
		for (const [idx, act] of inserted.entries()) {
			db.insert(prefsTable)
				.values({
					childId: testChildId,
					activityId: act.id,
					isPinned: 1,
					pinOrder: idx + 1,
				})
				.run();
		}

		const result = await countPinnedInCategory(testChildId, 1, TENANT);
		expect(result).toBe(3);

		// 旧 activities table への write 一切なし (1 段 ready)
		expect(countLegacyActivitiesTable(dbHolder.sqlite)).toBe(0);
	});

	it('AC-2: 異なる categoryId は集計対象外', async () => {
		if (!dbHolder.sqlite || !dbHolder.db) throw new Error('db not initialized');
		const db = dbHolder.db;

		const inserted = db
			.insert(childActivitiesTable)
			.values([
				{ childId: testChildId, name: '体操', categoryId: 1, icon: '🤸', basePoints: 5 },
				{ childId: testChildId, name: '読書', categoryId: 2, icon: '📖', basePoints: 5 },
				{ childId: testChildId, name: '勉強', categoryId: 2, icon: '📚', basePoints: 5 },
			])
			.returning()
			.all();

		for (const [idx, act] of inserted.entries()) {
			db.insert(prefsTable)
				.values({
					childId: testChildId,
					activityId: act.id,
					isPinned: 1,
					pinOrder: idx + 1,
				})
				.run();
		}

		// categoryId=1 は 1 件のみ (体操)
		expect(await countPinnedInCategory(testChildId, 1, TENANT)).toBe(1);
		// categoryId=2 は 2 件 (読書 + 勉強)
		expect(await countPinnedInCategory(testChildId, 2, TENANT)).toBe(2);
		// 存在しない categoryId は 0
		expect(await countPinnedInCategory(testChildId, 99, TENANT)).toBe(0);
	});

	it('AC-3: 別 childId の pin は集計対象外', async () => {
		if (!dbHolder.sqlite || !dbHolder.db) throw new Error('db not initialized');
		const db = dbHolder.db;

		const myActivity = db
			.insert(childActivitiesTable)
			.values({ childId: testChildId, name: '体操', categoryId: 1, icon: '🤸', basePoints: 5 })
			.returning()
			.get();
		const otherActivity = db
			.insert(childActivitiesTable)
			.values({ childId: otherChildId, name: 'マラソン', categoryId: 1, icon: '🏃', basePoints: 5 })
			.returning()
			.get();

		db.insert(prefsTable)
			.values({ childId: testChildId, activityId: myActivity.id, isPinned: 1, pinOrder: 1 })
			.run();
		db.insert(prefsTable)
			.values({ childId: otherChildId, activityId: otherActivity.id, isPinned: 1, pinOrder: 1 })
			.run();

		// 自分の child の pin のみ (1 件)
		expect(await countPinnedInCategory(testChildId, 1, TENANT)).toBe(1);
		expect(await countPinnedInCategory(otherChildId, 1, TENANT)).toBe(1);
	});

	it('AC-4: isPinned=0 は集計対象外', async () => {
		if (!dbHolder.sqlite || !dbHolder.db) throw new Error('db not initialized');
		const db = dbHolder.db;

		const acts = db
			.insert(childActivitiesTable)
			.values([
				{ childId: testChildId, name: '体操', categoryId: 1, icon: '🤸', basePoints: 5 },
				{ childId: testChildId, name: 'マラソン', categoryId: 1, icon: '🏃', basePoints: 5 },
			])
			.returning()
			.all();

		// 1 件目は pin、2 件目は unpin
		const [a1, a2] = acts;
		if (!a1 || !a2) throw new Error('seed failed');

		db.insert(prefsTable)
			.values({ childId: testChildId, activityId: a1.id, isPinned: 1, pinOrder: 1 })
			.run();
		db.insert(prefsTable)
			.values({ childId: testChildId, activityId: a2.id, isPinned: 0, pinOrder: null })
			.run();

		expect(await countPinnedInCategory(testChildId, 1, TENANT)).toBe(1);
	});

	it('AC-5: pin 0 件 のとき 0 を返す (entries 不在ケース)', async () => {
		if (!dbHolder.sqlite || !dbHolder.db) throw new Error('db not initialized');
		const db = dbHolder.db;

		db.insert(childActivitiesTable)
			.values({ childId: testChildId, name: '体操', categoryId: 1, icon: '🤸', basePoints: 5 })
			.run();
		// pin 未作成

		expect(await countPinnedInCategory(testChildId, 1, TENANT)).toBe(0);
	});
});
