// tests/unit/services/daily-mission-service.test.ts
// デイリーミッションのユニットテスト

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
vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => '2026-03-08',
}));

import { insertDailyMission } from '../../../src/lib/server/db/sqlite/daily-mission-repo';
import {
	checkMissionCompletion,
	getTodayMissions,
} from '../../../src/lib/server/services/daily-mission-service';

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
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

function seedActivities() {
	// #2362 PR-3 Phase 7b-2c: child_activities (per-child instance, childId=1) へ seed
	// 5カテゴリにそれぞれ1つ以上の活動
	const items = [
		{ name: 'たいそう', categoryId: 1, icon: '🏃' },
		{ name: 'かけっこ', categoryId: 1, icon: '🏃' },
		{ name: 'おべんきょう', categoryId: 2, icon: '📚' },
		{ name: 'ひらがな', categoryId: 2, icon: '✏️' },
		{ name: 'おかたづけ', categoryId: 3, icon: '🧹' },
		{ name: 'あいさつ', categoryId: 4, icon: '👋' },
		{ name: 'おえかき', categoryId: 5, icon: '🎨' },
	];
	for (const item of items) {
		testDb
			.insert(schema.childActivities)
			.values({ ...item, childId: 1, basePoints: 5 })
			.run();
	}
}

describe('getTodayMissions', () => {
	beforeEach(() => {
		resetDb();
		seedChild();
		seedActivities();
	});

	it('3つのミッションを自動生成する', async () => {
		const result = await getTodayMissions(1, 'test-tenant');
		expect(result.missions).toHaveLength(3);
		expect(result.completedCount).toBe(0);
		expect(result.allComplete).toBe(false);
		expect(result.bonusAwarded).toBe(0);
	});

	it('2回呼んでも同じミッションが返る', async () => {
		const first = await getTodayMissions(1, 'test-tenant');
		const second = await getTodayMissions(1, 'test-tenant');
		expect(first.missions.map((m) => m.activityId)).toEqual(
			second.missions.map((m) => m.activityId),
		);
	});

	it('各ミッションに活動名・アイコン・カテゴリが含まれる', async () => {
		const result = await getTodayMissions(1, 'test-tenant');
		for (const mission of result.missions) {
			expect(mission.activityName).toBeTypeOf('string');
			expect(mission.activityIcon).toBeTypeOf('string');
			expect(mission.categoryId).toBeTypeOf('number');
			expect(mission.completed).toBe(false);
		}
	});

	it('異なるカテゴリから選出される（可能な限り）', async () => {
		const result = await getTodayMissions(1, 'test-tenant');
		const categories = new Set(result.missions.map((m) => m.categoryId));
		// 5カテゴリあるので3つは別カテゴリから来るはず
		expect(categories.size).toBe(3);
	});
});

describe('エラーパス・境界値', () => {
	beforeEach(() => {
		resetDb();
	});

	it('存在しない子供IDでもエラーにならず空ミッションを返す', async () => {
		// #2362 PR-3 Phase 7b-2c: child_activities は childId FK 必須。
		// childId=1 用に child を先に seed し、その活動を作成 (999 はあえて存在しない別 id)
		seedChild();
		seedActivities();
		const result = await getTodayMissions(999, 'test-tenant');
		// 子供が存在しないため活動候補がフィルタされ、空ミッションを返す
		expect(result.missions).toHaveLength(0);
		expect(result.completedCount).toBe(0);
	});

	it('活動が0件の場合は空のミッションリストを返す', async () => {
		seedChild();
		// 活動を追加しない
		const result = await getTodayMissions(1, 'test-tenant');
		expect(result.missions).toHaveLength(0);
		expect(result.completedCount).toBe(0);
		expect(result.allComplete).toBe(false);
	});

	it('活動が1件しかない場合はミッション1つだけ生成', async () => {
		seedChild();
		// #2362 PR-3 Phase 7b-2c: child_activities へ insert (childId=1)
		testDb
			.insert(schema.childActivities)
			.values({ name: 'ランニング', childId: 1, categoryId: 1, icon: '🏃', basePoints: 5 })
			.run();
		const result = await getTodayMissions(1, 'test-tenant');
		expect(result.missions).toHaveLength(1);
	});

	it('活動が2件の場合はミッション2つだけ生成', async () => {
		seedChild();
		// #2362 PR-3 Phase 7b-2c: child_activities へ insert (childId=1)
		testDb
			.insert(schema.childActivities)
			.values({ name: 'ランニング', childId: 1, categoryId: 1, icon: '🏃', basePoints: 5 })
			.run();
		testDb
			.insert(schema.childActivities)
			.values({ name: 'おべんきょう', childId: 1, categoryId: 2, icon: '📚', basePoints: 5 })
			.run();
		const result = await getTodayMissions(1, 'test-tenant');
		expect(result.missions).toHaveLength(2);
	});
});

describe('利用履歴ベースのミッション生成', () => {
	beforeEach(() => {
		resetDb();
		seedChild();
		seedActivities();
	});

	it('直近7日で記録した活動が確実枠として含まれる', async () => {
		// activity_logs に「おかたづけ」(id=5) を直近で記録
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 5,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-07',
			})
			.run();

		// 多数回試行して、記録済み活動がミッションに含まれる確率を確認
		let includesRecorded = 0;
		const trials = 20;
		for (let i = 0; i < trials; i++) {
			sqlite.exec('DELETE FROM daily_missions');
			const result = await getTodayMissions(1, 'test-tenant');
			if (result.missions.some((m) => m.activityId === 5)) {
				includesRecorded++;
			}
		}
		// 確実枠があるので高確率で含まれるはず（20回中15回以上）
		expect(includesRecorded).toBeGreaterThanOrEqual(15);
	});

	it('利用履歴がない場合もミッションが3つ生成される', async () => {
		// activity_logsが空の状態（新規ユーザ）
		const result = await getTodayMissions(1, 'test-tenant');
		expect(result.missions).toHaveLength(3);
	});

	it('全ての活動を記録済みでもミッションが3つ生成される', async () => {
		// 全活動を記録済みにする
		// #2362 PR-3 Phase 7b-2c: child_activities を参照
		const allActs = testDb.select().from(schema.childActivities).all();
		for (const a of allActs) {
			testDb
				.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: a.id,
					points: 5,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: '2026-03-07',
				})
				.run();
		}

		const result = await getTodayMissions(1, 'test-tenant');
		expect(result.missions).toHaveLength(3);
	});
});

describe('checkMissionCompletion', () => {
	beforeEach(() => {
		resetDb();
		seedChild();
		seedActivities();
	});

	it('ミッションに含まれる活動を記録すると達成になる', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		const firstMission = missions.missions[0];
		if (!firstMission) throw new Error('Expected at least one mission');

		const result = await checkMissionCompletion(1, firstMission.activityId, 'test-tenant');
		expect(result.missionCompleted).toBe(true);

		// 再取得して完了状態を確認
		const updated = await getTodayMissions(1, 'test-tenant');
		expect(updated.completedCount).toBe(1);
	});

	it('ミッションに含まれない活動は影響しない', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		const missionActivityIds = new Set(missions.missions.map((m) => m.activityId));

		// ミッションに含まれない活動を探す
		// #2362 PR-3 Phase 7b-2c: child_activities を参照
		const allActivities = testDb.select().from(schema.childActivities).all();
		const nonMissionActivity = allActivities.find((a) => !missionActivityIds.has(a.id));
		if (!nonMissionActivity) return; // all activities are in missions

		const result = await checkMissionCompletion(1, nonMissionActivity.id, 'test-tenant');
		expect(result.missionCompleted).toBe(false);
	});

	it('2つ達成で+5Pボーナス', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		const m0 = missions.missions[0];
		const m1 = missions.missions[1];
		if (!m0 || !m1) throw new Error('Expected at least 2 missions');
		await checkMissionCompletion(1, m0.activityId, 'test-tenant');
		const result2 = await checkMissionCompletion(1, m1.activityId, 'test-tenant');
		expect(result2.bonusAwarded).toBe(5);
		expect(result2.allComplete).toBe(false);
	});

	it('3つ達成で+20Pボーナス（差分で+15P追加付与）', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		const m0 = missions.missions[0];
		const m1 = missions.missions[1];
		const m2 = missions.missions[2];
		if (!m0 || !m1 || !m2) throw new Error('Expected at least 3 missions');
		await checkMissionCompletion(1, m0.activityId, 'test-tenant');
		await checkMissionCompletion(1, m1.activityId, 'test-tenant');
		const result3 = await checkMissionCompletion(1, m2.activityId, 'test-tenant');
		expect(result3.allComplete).toBe(true);
		// 2/3で5P付与済み、3/3で20P。差分は15P
		expect(result3.bonusAwarded).toBe(15);
	});

	it('同じ活動を2回達成しても二重計上されない', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		const firstMission = missions.missions[0];
		if (!firstMission) throw new Error('Expected at least one mission');

		const result1 = await checkMissionCompletion(1, firstMission.activityId, 'test-tenant');
		expect(result1.missionCompleted).toBe(true);

		const result2 = await checkMissionCompletion(1, firstMission.activityId, 'test-tenant');
		expect(result2.missionCompleted).toBe(false);
	});
});

// #2565: getTodayMissions は check-then-generate の TOCTOU を持つため、同一 child home
// への並行リクエストが両方 generateMissions を実行すると同一 (child_id, mission_date,
// activity_id) で重複 INSERT し UNIQUE constraint (idx_daily_missions_unique) violation で
// 500 を返していた。E2E workers=2 で同一 worker DB を共有する child-tutorial spec が複数
// child home に並行アクセスして flake 化した root cause。insertDailyMission の
// onConflictDoNothing で構造的に解消する (ADR-0006: テスト側 retry でなく実装側 race の真因解消)。
describe('insertDailyMission 並行重複挿入 (#2565 flake root cause)', () => {
	beforeEach(() => {
		resetDb();
		seedChild();
		seedActivities();
	});

	it('同一 (childId, date, activityId) を二重挿入しても UNIQUE violation を起こさない', async () => {
		const childActivity = testDb.select().from(schema.childActivities).all()[0];
		if (!childActivity) throw new Error('Expected at least one child activity');

		// 1 回目の INSERT
		await insertDailyMission(1, '2026-03-08', childActivity.id, 'test-tenant');
		// 2 回目の INSERT (並行リクエストが同じ mission を再生成したケースを模す)。
		// fix 前は idx_daily_missions_unique violation で throw していた。
		await expect(
			insertDailyMission(1, '2026-03-08', childActivity.id, 'test-tenant'),
		).resolves.not.toThrow();

		// 重複 skip され DB には 1 行のみ
		const rows = testDb
			.select()
			.from(schema.dailyMissions)
			.where(eq(schema.dailyMissions.childId, 1))
			.all();
		expect(rows.filter((r) => r.activityId === childActivity.id)).toHaveLength(1);
	});

	it('getTodayMissions を並行実行しても UNIQUE violation で reject しない (500 root cause 解消)', async () => {
		// generateMissions の check-then-insert を 2 並列で実行。
		// fix 前は両方が同一 (child_id, mission_date, activity_id) を INSERT して
		// idx_daily_missions_unique violation で片方が reject → child home load が 500 →
		// tutorial 起動前に詰まって E2E flake していた。onConflictDoNothing で root cause を解消。
		const [first, second] = await Promise.all([
			getTodayMissions(1, 'test-tenant'),
			getTodayMissions(1, 'test-tenant'),
		]);
		// 両リクエストとも reject せず最低 3 件の mission を返す (dead-end / 500 にならない)。
		expect(first.missions.length).toBeGreaterThanOrEqual(3);
		expect(second.missions.length).toBeGreaterThanOrEqual(3);

		// 重複 activity の INSERT は skip されるため、DB 上に同一 activityId の mission は
		// 1 件のみ (UNIQUE 制約が onConflictDoNothing で守られている)。
		const rows = testDb
			.select()
			.from(schema.dailyMissions)
			.where(eq(schema.dailyMissions.childId, 1))
			.all();
		const activityIds = rows.map((r) => r.activityId);
		expect(new Set(activityIds).size).toBe(activityIds.length);
	});
});
