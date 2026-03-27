// tests/unit/services/daily-mission-service.test.ts
// デイリーミッションのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE categories (
		id INTEGER PRIMARY KEY,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		icon TEXT,
		color TEXT
	);

	INSERT INTO categories VALUES (1, 'undou', 'うんどう', '🏃', '#FF6B6B');
	INSERT INTO categories VALUES (2, 'benkyou', 'べんきょう', '📚', '#4ECDC4');
	INSERT INTO categories VALUES (3, 'seikatsu', 'せいかつ', '🏠', '#FFE66D');
	INSERT INTO categories VALUES (4, 'kouryuu', 'こうりゅう', '🤝', '#A8E6CF');
	INSERT INTO categories VALUES (5, 'souzou', 'そうぞう', '🎨', '#DDA0DD');

	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		active_title_id INTEGER,
		active_avatar_bg INTEGER,
		active_avatar_frame INTEGER,
		active_avatar_effect INTEGER,
		active_avatar_sound INTEGER,
		active_avatar_celebration INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		age_min INTEGER, age_max INTEGER,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'seed',
		grade_level TEXT, subcategory TEXT, description TEXT,
		name_kana TEXT,
		name_kanji TEXT,
		trigger_hint TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		points INTEGER NOT NULL, streak_days INTEGER NOT NULL DEFAULT 1,
		streak_bonus INTEGER NOT NULL DEFAULT 0,
		recorded_date TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		cancelled INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL, type TEXT NOT NULL,
		description TEXT, reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_point_ledger_child ON point_ledger(child_id, created_at);
	CREATE TABLE daily_missions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		mission_date TEXT NOT NULL,
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		completed INTEGER NOT NULL DEFAULT 0,
		completed_at TEXT,
		UNIQUE(child_id, mission_date, activity_id)
	);
	CREATE INDEX idx_daily_missions_child_date ON daily_missions(child_id, mission_date);
`;

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

import {
	checkMissionCompletion,
	getTodayMissions,
} from '../../../src/lib/server/services/daily-mission-service';

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	testDb = drizzle(sqlite, { schema });
});

afterAll(() => {
	sqlite.close();
});

function resetDb() {
	sqlite.exec('DELETE FROM daily_missions');
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children', 'activities', 'activity_logs', 'point_ledger', 'daily_missions')",
	);
}

function seedChild() {
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

function seedActivities() {
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
			.insert(schema.activities)
			.values({ ...item, basePoints: 5 })
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
			expect(mission.activityName).toBeTruthy();
			expect(mission.activityIcon).toBeTruthy();
			expect(mission.categoryId).toBeTruthy();
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
		const allActs = testDb.select().from(schema.activities).all();
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
		const firstMissionActivityId = missions.missions[0]!.activityId;

		const result = await checkMissionCompletion(1, firstMissionActivityId, 'test-tenant');
		expect(result.missionCompleted).toBe(true);

		// 再取得して完了状態を確認
		const updated = await getTodayMissions(1, 'test-tenant');
		expect(updated.completedCount).toBe(1);
	});

	it('ミッションに含まれない活動は影響しない', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		const missionActivityIds = new Set(missions.missions.map((m) => m.activityId));

		// ミッションに含まれない活動を探す
		const allActivities = testDb.select().from(schema.activities).all();
		const nonMissionActivity = allActivities.find((a) => !missionActivityIds.has(a.id));
		if (!nonMissionActivity) return; // all activities are in missions

		const result = await checkMissionCompletion(1, nonMissionActivity.id, 'test-tenant');
		expect(result.missionCompleted).toBe(false);
	});

	it('2つ達成で+5Pボーナス', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		await checkMissionCompletion(1, missions.missions[0]!.activityId, 'test-tenant');
		const result2 = await checkMissionCompletion(
			1,
			missions.missions[1]!.activityId,
			'test-tenant',
		);
		expect(result2.bonusAwarded).toBe(5);
		expect(result2.allComplete).toBe(false);
	});

	it('3つ達成で+20Pボーナス（差分で+15P追加付与）', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		await checkMissionCompletion(1, missions.missions[0]!.activityId, 'test-tenant');
		await checkMissionCompletion(1, missions.missions[1]!.activityId, 'test-tenant');
		const result3 = await checkMissionCompletion(
			1,
			missions.missions[2]!.activityId,
			'test-tenant',
		);
		expect(result3.allComplete).toBe(true);
		// 2/3で5P付与済み、3/3で20P。差分は15P
		expect(result3.bonusAwarded).toBe(15);
	});

	it('同じ活動を2回達成しても二重計上されない', async () => {
		const missions = await getTodayMissions(1, 'test-tenant');
		const firstId = missions.missions[0]!.activityId;

		const result1 = await checkMissionCompletion(1, firstId, 'test-tenant');
		expect(result1.missionCompleted).toBe(true);

		const result2 = await checkMissionCompletion(1, firstId, 'test-tenant');
		expect(result2.missionCompleted).toBe(false);
	});
});
