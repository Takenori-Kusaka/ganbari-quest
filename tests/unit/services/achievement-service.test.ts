// tests/unit/services/achievement-service.test.ts
// 実績サービスのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

// ---- テスト用インメモリ DB ----
let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL, category TEXT NOT NULL, icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		age_min INTEGER, age_max INTEGER,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
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
	CREATE UNIQUE INDEX idx_activity_logs_unique_daily ON activity_logs(child_id, activity_id, recorded_date);
	CREATE INDEX idx_activity_logs_child_date ON activity_logs(child_id, recorded_date);
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL, type TEXT NOT NULL,
		description TEXT, reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_point_ledger_child ON point_ledger(child_id, created_at);
	CREATE TABLE statuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category TEXT NOT NULL, value REAL NOT NULL DEFAULT 0.0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category);
	CREATE TABLE status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category TEXT NOT NULL, value REAL NOT NULL,
		change_amount REAL NOT NULL, change_type TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL, category TEXT NOT NULL,
		mean REAL NOT NULL, std_dev REAL NOT NULL,
		source TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category);
	CREATE TABLE achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
		description TEXT, icon TEXT NOT NULL, category TEXT,
		condition_type TEXT NOT NULL, condition_value INTEGER NOT NULL,
		bonus_points INTEGER NOT NULL, rarity TEXT NOT NULL DEFAULT 'common',
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE child_achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		achievement_id INTEGER NOT NULL REFERENCES achievements(id),
		unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_child_achievements_unique
		ON child_achievements(child_id, achievement_id);
`;

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

import {
	checkAndUnlockAchievements,
	getChildAchievements,
} from '../../../src/lib/server/services/achievement-service';

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
	sqlite.exec('DELETE FROM child_achievements');
	sqlite.exec('DELETE FROM achievements');
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM statuses');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec('DELETE FROM market_benchmarks');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','activities','activity_logs','point_ledger','achievements','child_achievements','statuses')",
	);
}

function seedBase() {
	resetDb();

	// 子供
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();

	// 活動マスタ（5カテゴリ分）
	const acts = [
		{ name: 'たいそう', category: 'うんどう', icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'えほん', category: 'べんきょう', icon: '📖', basePoints: 5, sortOrder: 2 },
		{ name: 'おえかき', category: 'そうぞう', icon: '🎨', basePoints: 5, sortOrder: 3 },
		{ name: 'はみがき', category: 'せいかつ', icon: '🪥', basePoints: 3, sortOrder: 4 },
		{ name: 'あいさつ', category: 'こうりゅう', icon: '👋', basePoints: 3, sortOrder: 5 },
	];
	for (const a of acts) {
		testDb.insert(schema.activities).values(a).run();
	}

	// ベンチマーク
	const benchmarks = [
		{ age: 4, category: 'うんどう', mean: 30.0, stdDev: 10.0 },
		{ age: 4, category: 'べんきょう', mean: 20.0, stdDev: 8.0 },
		{ age: 4, category: 'そうぞう', mean: 25.0, stdDev: 9.0 },
		{ age: 4, category: 'せいかつ', mean: 35.0, stdDev: 8.0 },
		{ age: 4, category: 'こうりゅう', mean: 25.0, stdDev: 10.0 },
	];
	for (const b of benchmarks) {
		testDb.insert(schema.marketBenchmarks).values(b).run();
	}

	// ステータス初期値
	const statuses = [
		{ childId: 1, category: 'うんどう', value: 30.0 },
		{ childId: 1, category: 'べんきょう', value: 20.0 },
		{ childId: 1, category: 'そうぞう', value: 25.0 },
		{ childId: 1, category: 'せいかつ', value: 35.0 },
		{ childId: 1, category: 'こうりゅう', value: 25.0 },
	];
	for (const s of statuses) {
		testDb.insert(schema.statuses).values(s).run();
	}
}

function seedAchievements() {
	testDb
		.insert(schema.achievements)
		.values([
			{
				code: 'first_activity',
				name: 'はじめてのきろく',
				icon: '🌟',
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
			},
			{
				code: 'streak_3',
				name: '3にちれんぞく',
				icon: '🔥',
				conditionType: 'streak_days',
				conditionValue: 3,
				bonusPoints: 20,
				rarity: 'common',
				sortOrder: 2,
			},
			{
				code: 'activities_10',
				name: '10かいきろく',
				icon: '📝',
				conditionType: 'total_activities',
				conditionValue: 10,
				bonusPoints: 30,
				rarity: 'common',
				sortOrder: 3,
			},
			{
				code: 'all_categories',
				name: 'ぜんぶのカテゴリ',
				icon: '🌈',
				conditionType: 'all_categories',
				conditionValue: 1,
				bonusPoints: 50,
				rarity: 'rare',
				sortOrder: 4,
			},
			{
				code: 'level_5',
				name: 'レベル5とうたつ',
				icon: '⭐',
				conditionType: 'level_reach',
				conditionValue: 5,
				bonusPoints: 100,
				rarity: 'rare',
				sortOrder: 5,
			},
			{
				code: 'points_100',
				name: '100ポイント',
				icon: '💰',
				conditionType: 'total_points',
				conditionValue: 100,
				bonusPoints: 30,
				rarity: 'common',
				sortOrder: 6,
			},
		])
		.run();
}

describe('checkAndUnlockAchievements', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('初回活動で first_activity を解除する', () => {
		// 活動記録を1件挿入
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-02-25',
			})
			.run();

		const unlocked = checkAndUnlockAchievements(1);

		expect(unlocked.length).toBeGreaterThanOrEqual(1);
		const firstActivity = unlocked.find((a) => a.code === 'first_activity');
		expect(firstActivity).toBeDefined();
		expect(firstActivity?.bonusPoints).toBe(10);
	});

	it('解除時にポイント台帳に achievement エントリが追加される', () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		checkAndUnlockAchievements(1);

		const ledger = testDb.select().from(schema.pointLedger).all();
		const achievementEntries = ledger.filter((e) => e.type === 'achievement');
		expect(achievementEntries.length).toBeGreaterThanOrEqual(1);
		expect(achievementEntries[0]?.amount).toBe(10); // first_activity bonus
	});

	it('既に解除済みの実績は重複解除しない', () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		// 1回目
		const first = checkAndUnlockAchievements(1);
		const firstCodes = first.map((a) => a.code);
		expect(firstCodes).toContain('first_activity');

		// 2回目（同じ状態）
		const second = checkAndUnlockAchievements(1);
		const secondCodes = second.map((a) => a.code);
		expect(secondCodes).not.toContain('first_activity');
	});

	it('条件未達成なら解除しない', () => {
		// 活動記録なし
		const unlocked = checkAndUnlockAchievements(1);
		expect(unlocked).toHaveLength(0);
	});

	it('3日連続で streak_3 を解除する', () => {
		const dates = ['2026-02-23', '2026-02-24', '2026-02-25'];
		for (const date of dates) {
			testDb
				.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: 1,
					points: 5,
					recordedDate: date,
				})
				.run();
		}

		const unlocked = checkAndUnlockAchievements(1);
		const streak3 = unlocked.find((a) => a.code === 'streak_3');
		expect(streak3).toBeDefined();
		expect(streak3?.bonusPoints).toBe(20);
	});

	it('全カテゴリ記録で all_categories を解除する', () => {
		// 5カテゴリ分の活動を同日に記録
		for (let i = 1; i <= 5; i++) {
			testDb
				.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: i,
					points: 5,
					recordedDate: '2026-02-25',
				})
				.run();
		}

		const unlocked = checkAndUnlockAchievements(1);
		const allCat = unlocked.find((a) => a.code === 'all_categories');
		expect(allCat).toBeDefined();
		expect(allCat?.bonusPoints).toBe(50);
	});

	it('累計ポイントで points_100 を解除する', () => {
		// 100ポイント分のポイント台帳を用意
		testDb
			.insert(schema.pointLedger)
			.values({ childId: 1, amount: 100, type: 'activity', description: 'テスト' })
			.run();

		// 活動記録も1件あれば first_activity も解除
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		const unlocked = checkAndUnlockAchievements(1);
		const points100 = unlocked.find((a) => a.code === 'points_100');
		expect(points100).toBeDefined();
		expect(points100?.bonusPoints).toBe(30);
	});
});

describe('getChildAchievements', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('全実績一覧を返す', () => {
		const achievements = getChildAchievements(1);
		expect(achievements).toHaveLength(6);
	});

	it('未解除の実績は unlockedAt が null', () => {
		const achievements = getChildAchievements(1);
		expect(achievements.every((a) => a.unlockedAt === null)).toBe(true);
	});

	it('解除済みの実績には unlockedAt が設定される', () => {
		// 活動記録を追加して実績解除
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();
		checkAndUnlockAchievements(1);

		const achievements = getChildAchievements(1);
		const firstActivity = achievements.find((a) => a.code === 'first_activity');
		expect(firstActivity?.unlockedAt).not.toBeNull();

		// 未解除のものは null のまま
		const streak3 = achievements.find((a) => a.code === 'streak_3');
		expect(streak3?.unlockedAt).toBeNull();
	});

	it('sortOrder 順に並ぶ', () => {
		const achievements = getChildAchievements(1);
		for (let i = 1; i < achievements.length; i++) {
			expect(achievements[i]?.sortOrder).toBeGreaterThanOrEqual(achievements[i - 1]?.sortOrder);
		}
	});
});
