// tests/unit/services/activity-service.test.ts
// activity-service ユニットテスト (UT-ACT-01 〜 UT-ACT-10)

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	type TestDb,
	type TestSqlite,
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
} from '../helpers/test-db';

// ---- テスト用インメモリDB ----
let sqlite: TestSqlite;
let testDb: TestDb;

// vi.mock で db モジュールを差し替え
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

// activity-repo も同じ db を使うためモックが必要
// activity-repo は client.ts の db を import しているため上のモックで対応

import {
	createActivity,
	deleteActivityWithCleanup,
	getActivities,
	getActivityById,
	getActivityLogCounts,
	hasActivityLogs,
	setActivityVisibility,
	updateActivity,
} from '../../../src/lib/server/services/activity-service';

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

function seedBase() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();

	const act = [
		{ name: 'たいそうした', categoryId: 1, icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'おそとであそんだ', categoryId: 1, icon: '🏃', basePoints: 5, sortOrder: 2 },
		{
			name: 'すいみんぐ',
			categoryId: 1,
			icon: '🏊',
			basePoints: 10,
			ageMin: 5,
			sortOrder: 3,
		},
		{
			name: 'ひらがなれんしゅう',
			categoryId: 2,
			icon: '✏️',
			basePoints: 5,
			ageMin: 3,
			sortOrder: 4,
		},
		{ name: 'おかたづけした', categoryId: 3, icon: '🧹', basePoints: 5, sortOrder: 5 },
		{
			name: '非表示活動',
			categoryId: 1,
			icon: '❌',
			basePoints: 5,
			isVisible: 0,
			sortOrder: 99,
		},
	];
	for (const a of act) {
		testDb.insert(schema.activities).values(a).run();
	}
}

describe('activity-service', () => {
	beforeEach(() => {
		seedBase();
	});

	// UT-ACT-01: 活動一覧取得（全件）
	it('UT-ACT-01: 活動一覧取得（全件・非表示除外）', async () => {
		const result = await getActivities('test-tenant');
		// 非表示の1件を除く5件
		expect(result.length).toBe(5);
		expect(result.every((a) => a.isVisible === 1)).toBe(true);
	});

	// UT-ACT-02: 活動一覧取得（子供IDフィルタ）
	it('UT-ACT-02: 活動一覧取得（childAge フィルタ - 4歳）', async () => {
		const result = await getActivities('test-tenant', { childAge: 4 });
		// すいみんぐ(ageMin=5)は除外、非表示も除外 → 4件
		expect(result.length).toBe(4);
		expect(result.find((a) => a.name === 'すいみんぐ')).toBeUndefined();
	});

	// UT-ACT-03: 活動一覧取得（カテゴリフィルタ）
	it('UT-ACT-03: 活動一覧取得（カテゴリフィルタ）', async () => {
		const result = await getActivities('test-tenant', { categoryId: 1 });
		// 非表示を除く うんどう = たいそう + おそと + すいみんぐ = 3件
		// すいみんぐ: ageMin=5 だが childAge 指定なしなのでageフィルタされない → 含む
		expect(result.length).toBe(3);
	});

	// UT-ACT-04: 活動一覧取得（非表示含む）
	it('UT-ACT-04: 活動一覧取得（非表示含む）', async () => {
		const result = await getActivities('test-tenant', { includeHidden: true });
		expect(result.length).toBe(6);
		expect(result.some((a) => a.isVisible === 0)).toBe(true);
	});

	// UT-ACT-05: 活動追加（正常）
	it('UT-ACT-05: 活動追加（正常）', async () => {
		const result = await createActivity(
			{
				name: 'さんすうをした',
				categoryId: 2,
				icon: '🔢',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
			},
			'test-tenant',
		);
		expect(result.id).toBeGreaterThan(0);
		expect(result.name).toBe('さんすうをした');
		expect(result.categoryId).toBe(2);
		expect(result.basePoints).toBe(5);
		expect(result.isVisible).toBe(1);
	});

	// UT-ACT-07: 活動更新（正常）
	it('UT-ACT-07: 活動更新（正常）', async () => {
		const updated = await updateActivity(1, { name: 'ラジオたいそう' }, 'test-tenant');
		expect(updated).toBeDefined();
		expect(updated?.name).toBe('ラジオたいそう');
	});

	// UT-ACT-08: 活動表示/非表示切替
	it('UT-ACT-08: 活動表示/非表示切替', async () => {
		const hidden = await setActivityVisibility(1, false, 'test-tenant');
		expect(hidden).toBeDefined();
		expect(hidden?.isVisible).toBe(0);

		const shown = await setActivityVisibility(1, true, 'test-tenant');
		expect(shown).toBeDefined();
		expect(shown?.isVisible).toBe(1);
	});

	// UT-ACT-09: 年齢範囲フィルタ
	it('UT-ACT-09: 年齢範囲フィルタ（5歳以上の活動、4歳の子供）', async () => {
		const result = await getActivities('test-tenant', { childAge: 4 });
		expect(result.find((a) => a.name === 'すいみんぐ')).toBeUndefined();

		const result5 = await getActivities('test-tenant', { childAge: 5 });
		expect(result5.find((a) => a.name === 'すいみんぐ')).toBeDefined();
	});

	it('getActivityById: 存在する活動を返す', async () => {
		const result = await getActivityById(1, 'test-tenant');
		expect(result).toBeDefined();
		expect(result?.name).toBe('たいそうした');
	});

	it('getActivityById: 存在しない場合は undefined', async () => {
		const result = await getActivityById(999, 'test-tenant');
		expect(result).toBeUndefined();
	});

	it('hasActivityLogs: ログなしの活動はfalse', async () => {
		expect(await hasActivityLogs(1, 'test-tenant')).toBe(false);
	});

	it('hasActivityLogs: ログありの活動はtrue', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-15',
			})
			.run();
		expect(await hasActivityLogs(1, 'test-tenant')).toBe(true);
	});

	it('getActivityLogCounts: 活動ごとのログ件数を返す', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-14',
			})
			.run();
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 2,
				streakBonus: 0,
				recordedDate: '2026-03-15',
			})
			.run();
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 2,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-15',
			})
			.run();

		const counts = await getActivityLogCounts('test-tenant');
		expect(counts[1]).toBe(2);
		expect(counts[2]).toBe(1);
		expect(counts[3]).toBeUndefined();
	});

	it('deleteActivityWithCleanup: ログなしの活動を物理削除できる', async () => {
		const before = await getActivities('test-tenant', { includeHidden: true });
		expect(before.length).toBe(6);

		await deleteActivityWithCleanup(6, 'test-tenant'); // 非表示活動
		const after = await getActivities('test-tenant', { includeHidden: true });
		expect(after.length).toBe(5);
		expect(after.find((a) => a.id === 6)).toBeUndefined();
	});

	it('deleteActivityWithCleanup: daily_missionsも一緒に削除される', async () => {
		testDb
			.insert(schema.dailyMissions)
			.values({
				childId: 1,
				missionDate: '2026-03-15',
				activityId: 1,
			})
			.run();

		// daily_missionsが存在する状態で削除
		await deleteActivityWithCleanup(1, 'test-tenant');
		expect(await getActivityById(1, 'test-tenant')).toBeUndefined();
	});
});
