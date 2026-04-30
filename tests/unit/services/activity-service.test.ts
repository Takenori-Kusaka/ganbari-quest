// tests/unit/services/activity-service.test.ts
// activity-service ユニットテスト (UT-ACT-01 〜 UT-ACT-10)

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
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

// ============================================================
// #1755 (#1709-A): activity priority — 「今日のおやくそく」
// ============================================================

import {
	computeMustCompletionBonus,
	getMustActivitiesToday,
	MUST_COMPLETION_BONUS_TYPE,
	tryGrantMustCompletionBonus,
} from '../../../src/lib/server/services/activity-service';

describe('#1755 activity-service priority', () => {
	beforeEach(() => {
		seedBase();
	});

	// 1. priority='must' で活動を create → list で priority='must' を返す
	it("UT-ACT-PRIORITY-01: priority='must' で create した活動が list で 'must' で返る", async () => {
		const created = await createActivity(
			{
				name: 'はみがきした',
				categoryId: 3,
				icon: '🪥',
				basePoints: 3,
				ageMin: null,
				ageMax: null,
				priority: 'must',
			},
			'test-tenant',
		);
		expect(created.priority).toBe('must');

		const all = await getActivities('test-tenant', { includeHidden: true });
		const found = all.find((a) => a.id === created.id);
		expect(found?.priority).toBe('must');
	});

	// 2. getMustActivitiesToday が must 属性活動のみ返す（optional は除外）
	it('UT-ACT-PRIORITY-02: getMustActivitiesToday は priority=must の活動のみ返す', async () => {
		// seedBase() で投入されている activities (id=1..6) は全て priority='optional' (default)
		// is the must を 1 件だけ作成
		const must = await createActivity(
			{
				name: 'おやくそく活動',
				categoryId: 3,
				icon: '⭐',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
				priority: 'must',
			},
			'test-tenant',
		);

		const today = '2026-04-30';
		const result = await getMustActivitiesToday(1, today, 'test-tenant');

		expect(result.total).toBe(1);
		expect(result.activities).toHaveLength(1);
		expect(result.activities[0]?.id).toBe(must.id);
		expect(result.activities[0]?.loggedToday).toBe(0);
		expect(result.logged).toBe(0);
	});

	// 2b. 全 must が今日記録済みなら logged === total
	it('UT-ACT-PRIORITY-02b: 全 must を今日記録すると logged が total に等しい', async () => {
		const must1 = await createActivity(
			{
				name: 'はみがきした',
				categoryId: 3,
				icon: '🪥',
				basePoints: 3,
				ageMin: null,
				ageMax: null,
				priority: 'must',
			},
			'test-tenant',
		);
		const must2 = await createActivity(
			{
				name: 'おきがえした',
				categoryId: 3,
				icon: '👕',
				basePoints: 3,
				ageMin: null,
				ageMax: null,
				priority: 'must',
			},
			'test-tenant',
		);

		const today = '2026-04-30';
		const childId = 1;
		// 今日のログを 2 件投入
		testDb
			.insert(schema.activityLogs)
			.values([
				{
					childId,
					activityId: must1.id,
					points: 3,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: today,
					recordedAt: `${today}T08:00:00Z`,
					cancelled: 0,
				},
				{
					childId,
					activityId: must2.id,
					points: 3,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: today,
					recordedAt: `${today}T08:30:00Z`,
					cancelled: 0,
				},
			])
			.run();

		const result = await getMustActivitiesToday(childId, today, 'test-tenant');
		expect(result.total).toBe(2);
		expect(result.logged).toBe(2);
		expect(result.activities.every((a) => a.loggedToday === 1)).toBe(true);
	});

	// 3. computeMustCompletionBonus('preschool', true) === 5
	it('UT-ACT-PRIORITY-03: 全達成時 preschool は +5pt', () => {
		expect(computeMustCompletionBonus('preschool', true)).toBe(5);
		expect(computeMustCompletionBonus('elementary', true)).toBe(5);
	});

	// 4. computeMustCompletionBonus('junior', true) === 3
	it('UT-ACT-PRIORITY-04: 全達成時 junior / senior は +3pt', () => {
		expect(computeMustCompletionBonus('junior', true)).toBe(3);
		expect(computeMustCompletionBonus('senior', true)).toBe(3);
	});

	// 5. computeMustCompletionBonus('preschool', false) === 0
	it('UT-ACT-PRIORITY-05: 未達成時はどの年齢でも 0pt（baby は常に 0pt）', () => {
		expect(computeMustCompletionBonus('preschool', false)).toBe(0);
		expect(computeMustCompletionBonus('elementary', false)).toBe(0);
		expect(computeMustCompletionBonus('junior', false)).toBe(0);
		expect(computeMustCompletionBonus('senior', false)).toBe(0);
		// baby は ADR-0011（baby = 親の準備モード、ゲーミフィケーション不適用）に従い常に 0
		expect(computeMustCompletionBonus('baby', true)).toBe(0);
		expect(computeMustCompletionBonus('baby', false)).toBe(0);
	});
});

// ============================================================
// #1757 (#1709-C): tryGrantMustCompletionBonus（冪等付与）
// ============================================================

describe('#1757 tryGrantMustCompletionBonus', () => {
	const TODAY = '2026-04-30';

	beforeEach(() => {
		seedBase();
	});

	function createMustActivity(name: string) {
		return createActivity(
			{
				name,
				categoryId: 3,
				icon: '⭐',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
				priority: 'must',
			},
			'test-tenant',
		);
	}

	function recordMust(childId: number, activityId: number, hour = 8) {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId,
				activityId,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: TODAY,
				recordedAt: `${TODAY}T0${hour}:00:00Z`,
				cancelled: 0,
			})
			.run();
	}

	function pointLedgerCount(childId: number, type: string): number {
		const rows = testDb
			.select()
			.from(schema.pointLedger)
			.where(eq(schema.pointLedger.childId, childId))
			.all();
		return rows.filter((r) => r.type === type).length;
	}

	// UT-ACT-PRIORITY-BONUS-01: must=0 件 → granted=false / total=0
	it('UT-ACT-PRIORITY-BONUS-01: must 活動が 0 件のときは付与せず total=0 を返す', async () => {
		const result = await tryGrantMustCompletionBonus(1, TODAY, 'preschool', 'test-tenant');
		expect(result.total).toBe(0);
		expect(result.logged).toBe(0);
		expect(result.allComplete).toBe(false);
		expect(result.granted).toBe(false);
		expect(result.points).toBe(0);
		expect(pointLedgerCount(1, MUST_COMPLETION_BONUS_TYPE)).toBe(0);
	});

	// UT-ACT-PRIORITY-BONUS-02: 部分達成 → granted=false / points=0
	it('UT-ACT-PRIORITY-BONUS-02: 部分達成では付与せず allComplete=false を返す', async () => {
		const must1 = await createMustActivity('はみがき');
		// must2 を作成して total=2、logged=1 (must1 のみ記録) の状態を作る
		await createMustActivity('おきがえ');
		recordMust(1, must1.id);

		const result = await tryGrantMustCompletionBonus(1, TODAY, 'preschool', 'test-tenant');
		expect(result.total).toBe(2);
		expect(result.logged).toBe(1);
		expect(result.allComplete).toBe(false);
		expect(result.granted).toBe(false);
		expect(result.points).toBe(0);
		expect(pointLedgerCount(1, MUST_COMPLETION_BONUS_TYPE)).toBe(0);
	});

	// UT-ACT-PRIORITY-BONUS-03: preschool 全達成 → +5pt 付与
	it('UT-ACT-PRIORITY-BONUS-03: preschool 全達成で +5pt 付与（point_ledger に 1 行）', async () => {
		const must1 = await createMustActivity('はみがき');
		const must2 = await createMustActivity('おきがえ');
		recordMust(1, must1.id);
		recordMust(1, must2.id, 9);

		const result = await tryGrantMustCompletionBonus(1, TODAY, 'preschool', 'test-tenant');
		expect(result.allComplete).toBe(true);
		expect(result.granted).toBe(true);
		expect(result.points).toBe(5);
		expect(pointLedgerCount(1, MUST_COMPLETION_BONUS_TYPE)).toBe(1);
	});

	// UT-ACT-PRIORITY-BONUS-04: junior 全達成 → +3pt 付与
	it('UT-ACT-PRIORITY-BONUS-04: junior 全達成で +3pt 付与', async () => {
		const must1 = await createMustActivity('歯磨き');
		recordMust(1, must1.id);

		const result = await tryGrantMustCompletionBonus(1, TODAY, 'junior', 'test-tenant');
		expect(result.allComplete).toBe(true);
		expect(result.granted).toBe(true);
		expect(result.points).toBe(3);
	});

	// UT-ACT-PRIORITY-BONUS-05: 同日 2 回目は granted=false（冪等）
	it('UT-ACT-PRIORITY-BONUS-05: 同日 2 回目の呼び出しは granted=false / 重複加算なし', async () => {
		const must1 = await createMustActivity('はみがき');
		recordMust(1, must1.id);

		const first = await tryGrantMustCompletionBonus(1, TODAY, 'preschool', 'test-tenant');
		expect(first.granted).toBe(true);
		expect(first.points).toBe(5);

		const second = await tryGrantMustCompletionBonus(1, TODAY, 'preschool', 'test-tenant');
		expect(second.allComplete).toBe(true);
		expect(second.granted).toBe(false);
		expect(second.points).toBe(0);
		// point_ledger は 1 行のみ（重複加算なし）
		expect(pointLedgerCount(1, MUST_COMPLETION_BONUS_TYPE)).toBe(1);
	});

	// UT-ACT-PRIORITY-BONUS-06: baby は granted=false / 0pt（ボーナス対象外）
	it('UT-ACT-PRIORITY-BONUS-06: baby は全達成でも granted=false / 0pt（ADR-0011）', async () => {
		const must1 = await createMustActivity('はみがき');
		recordMust(1, must1.id);

		const result = await tryGrantMustCompletionBonus(1, TODAY, 'baby', 'test-tenant');
		expect(result.allComplete).toBe(true);
		expect(result.granted).toBe(false);
		expect(result.points).toBe(0);
		expect(pointLedgerCount(1, MUST_COMPLETION_BONUS_TYPE)).toBe(0);
	});
});
