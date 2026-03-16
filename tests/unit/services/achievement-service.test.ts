// tests/unit/services/achievement-service.test.ts
// 実績サービスのユニットテスト（マイルストーン型対応）

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

// ---- テスト用インメモリ DB ----
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
		category_id INTEGER NOT NULL REFERENCES categories(id), value REAL NOT NULL DEFAULT 0.0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category_id);
	CREATE TABLE status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id), value REAL NOT NULL,
		change_amount REAL NOT NULL, change_type TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id),
		mean REAL NOT NULL, std_dev REAL NOT NULL,
		source TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category_id);
	CREATE TABLE achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
		description TEXT, icon TEXT NOT NULL, category TEXT,
		condition_type TEXT NOT NULL, condition_value INTEGER NOT NULL,
		bonus_points INTEGER NOT NULL, rarity TEXT NOT NULL DEFAULT 'common',
		sort_order INTEGER NOT NULL DEFAULT 0,
		repeatable INTEGER NOT NULL DEFAULT 0,
		milestone_values TEXT,
		is_milestone INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE child_achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		achievement_id INTEGER NOT NULL REFERENCES achievements(id),
		milestone_value INTEGER,
		unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_child_achievements_unique
		ON child_achievements(child_id, achievement_id, milestone_value);
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
		{ name: 'たいそう', categoryId: 1, icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'えほん', categoryId: 2, icon: '📖', basePoints: 5, sortOrder: 2 },
		{ name: 'おえかき', categoryId: 5, icon: '🎨', basePoints: 5, sortOrder: 3 },
		{ name: 'はみがき', categoryId: 3, icon: '🪥', basePoints: 3, sortOrder: 4 },
		{ name: 'あいさつ', categoryId: 4, icon: '👋', basePoints: 3, sortOrder: 5 },
	];
	for (const a of acts) {
		testDb.insert(schema.activities).values(a).run();
	}

	// ベンチマーク
	const benchmarks = [
		{ age: 4, categoryId: 1, mean: 30.0, stdDev: 10.0 },
		{ age: 4, categoryId: 2, mean: 20.0, stdDev: 8.0 },
		{ age: 4, categoryId: 5, mean: 25.0, stdDev: 9.0 },
		{ age: 4, categoryId: 3, mean: 35.0, stdDev: 8.0 },
		{ age: 4, categoryId: 4, mean: 25.0, stdDev: 10.0 },
	];
	for (const b of benchmarks) {
		testDb.insert(schema.marketBenchmarks).values(b).run();
	}

	// ステータス初期値
	const statuses = [
		{ childId: 1, categoryId: 1, value: 30.0 },
		{ childId: 1, categoryId: 2, value: 20.0 },
		{ childId: 1, categoryId: 5, value: 25.0 },
		{ childId: 1, categoryId: 3, value: 35.0 },
		{ childId: 1, categoryId: 4, value: 25.0 },
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
				code: 'first_step',
				name: 'はじめのいっぽ',
				icon: '🌟',
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			},
			{
				code: 'streak_master',
				name: 'れんぞくチャレンジ',
				icon: '🔥',
				conditionType: 'streak_days',
				conditionValue: 3,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 2,
				repeatable: 1,
				milestoneValues: JSON.stringify([3, 5, 7]),
			},
			{
				code: 'activity_master',
				name: 'かつどうマスター',
				icon: '📝',
				conditionType: 'total_activities',
				conditionValue: 10,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 3,
				repeatable: 1,
				milestoneValues: JSON.stringify([10, 30, 50]),
			},
			{
				code: 'category_scout',
				name: 'カテゴリたんけんか',
				icon: '🧭',
				conditionType: 'category_complete',
				conditionValue: 2,
				bonusPoints: 15,
				rarity: 'common',
				sortOrder: 4,
				repeatable: 1,
				milestoneValues: JSON.stringify([2, 3, 5]),
			},
			{
				code: 'category_explorer',
				name: 'カテゴリたんけん',
				icon: '🌈',
				conditionType: 'all_categories',
				conditionValue: 1,
				bonusPoints: 50,
				rarity: 'rare',
				sortOrder: 5,
				repeatable: 0,
			},
			{
				code: 'point_collector',
				name: 'ポイントコレクター',
				icon: '💰',
				conditionType: 'total_points',
				conditionValue: 100,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 5,
				repeatable: 1,
				milestoneValues: JSON.stringify([100, 500]),
			},
			{
				code: 'kindergarten_grad',
				name: 'ほいくえんそつえん',
				icon: '🎓',
				conditionType: 'milestone_event',
				conditionValue: 0,
				bonusPoints: 500,
				rarity: 'legendary',
				sortOrder: 100,
				repeatable: 0,
				isMilestone: 1,
			},
		])
		.run();
}

describe('checkAndUnlockAchievements', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('初回活動で first_step を解除する', () => {
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
		const firstStep = unlocked.find((a) => a.code === 'first_step');
		expect(firstStep).toBeDefined();
		expect(firstStep?.bonusPoints).toBe(10);
		expect(firstStep?.milestoneValue).toBeNull();
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
		expect(achievementEntries[0]?.amount).toBe(10);
	});

	it('既に解除済みの一度きり実績は重複解除しない', () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		const first = checkAndUnlockAchievements(1);
		expect(first.map((a) => a.code)).toContain('first_step');

		const second = checkAndUnlockAchievements(1);
		expect(second.map((a) => a.code)).not.toContain('first_step');
	});

	it('条件未達成なら解除しない', () => {
		const unlocked = checkAndUnlockAchievements(1);
		expect(unlocked).toHaveLength(0);
	});

	it('3日連続で streak_master のマイルストーン3を解除する', () => {
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
		const streak = unlocked.find((a) => a.code === 'streak_master');
		expect(streak).toBeDefined();
		expect(streak?.milestoneValue).toBe(3);
		expect(streak?.bonusPoints).toBe(10); // base * (index 0 + 1)
	});

	it('全カテゴリ記録で category_explorer を解除する', () => {
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
		const allCat = unlocked.find((a) => a.code === 'category_explorer');
		expect(allCat).toBeDefined();
		expect(allCat?.bonusPoints).toBe(50);
	});

	it('累計ポイントで point_collector マイルストーン100を解除する', () => {
		testDb
			.insert(schema.pointLedger)
			.values({ childId: 1, amount: 100, type: 'activity', description: 'テスト' })
			.run();
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
		const points = unlocked.find((a) => a.code === 'point_collector');
		expect(points).toBeDefined();
		expect(points?.milestoneValue).toBe(100);
		expect(points?.bonusPoints).toBe(10); // base * 1
	});

	it('ライフイベント（milestone_event）は自動解除されない', () => {
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
		const lifeEvent = unlocked.find((a) => a.code === 'kindergarten_grad');
		expect(lifeEvent).toBeUndefined();
	});

	it('繰り返し実績は次のマイルストーンも解除できる', () => {
		// 5日連続分の活動記録
		const dates = ['2026-02-21', '2026-02-22', '2026-02-23', '2026-02-24', '2026-02-25'];
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

		// 1回目: milestone 3 と 5 を解除
		const first = checkAndUnlockAchievements(1);
		const streakUnlocks = first.filter((a) => a.code === 'streak_master');
		expect(streakUnlocks.length).toBe(2);
		expect(streakUnlocks.map((a) => a.milestoneValue).sort()).toEqual([3, 5]);

		// 2回目: 重複しない
		const second = checkAndUnlockAchievements(1);
		const streakSecond = second.filter((a) => a.code === 'streak_master');
		expect(streakSecond).toHaveLength(0);
	});
});

describe('getChildAchievements', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('全実績一覧を返す', () => {
		const achievements = getChildAchievements(1);
		expect(achievements).toHaveLength(7);
	});

	it('未解除の実績は unlockedAt が null', () => {
		const achievements = getChildAchievements(1);
		expect(achievements.every((a) => a.unlockedAt === null)).toBe(true);
	});

	it('解除済みの一度きり実績には unlockedAt が設定される', () => {
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
		const firstStep = achievements.find((a) => a.code === 'first_step');
		expect(firstStep?.unlockedAt).not.toBeNull();

		// 未解除の繰り返し実績（マイルストーン未到達分）
		const activityMaster = achievements.find((a) => a.code === 'activity_master');
		expect(activityMaster?.unlockedAt).toBeNull();
	});

	it('sortOrder 順に並ぶ', () => {
		const achievements = getChildAchievements(1);
		for (let i = 1; i < achievements.length; i++) {
			expect(achievements[i]!.sortOrder).toBeGreaterThanOrEqual(achievements[i - 1]!.sortOrder);
		}
	});

	it('繰り返し実績にはマイルストーン情報が含まれる', () => {
		const achievements = getChildAchievements(1);
		const streak = achievements.find((a) => a.code === 'streak_master');
		expect(streak?.repeatable).toBe(true);
		expect(streak?.milestones).toHaveLength(3); // [3,5,7]
		expect(streak?.milestones[0]?.value).toBe(3);
		expect(streak?.milestones[0]?.unlocked).toBe(false);
		expect(streak?.nextMilestone).toBe(3);
	});

	it('マイルストーン解除後は次のマイルストーンが表示される', () => {
		// 3日連続
		for (const d of ['2026-02-23', '2026-02-24', '2026-02-25']) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: d })
				.run();
		}
		checkAndUnlockAchievements(1);

		const achievements = getChildAchievements(1);
		const streak = achievements.find((a) => a.code === 'streak_master');
		expect(streak?.highestUnlockedMilestone).toBe(3);
		expect(streak?.nextMilestone).toBe(5);
		expect(streak?.milestones[0]?.unlocked).toBe(true);
	});

	it('ライフイベントは isMilestone=true で返される', () => {
		const achievements = getChildAchievements(1);
		const grad = achievements.find((a) => a.code === 'kindergarten_grad');
		expect(grad?.isMilestone).toBe(true);
		expect(grad?.conditionType).toBe('milestone_event');
	});
});

describe('category_scout (カテゴリたんけんか)', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('2カテゴリの活動で category_scout M=2 を解除する', () => {
		// うんどう + べんきょう の2カテゴリ
		testDb.insert(schema.activityLogs).values({
			childId: 1, activityId: 1, points: 5, streakDays: 1, streakBonus: 0, recordedDate: '2026-03-01',
		}).run();
		testDb.insert(schema.activityLogs).values({
			childId: 1, activityId: 2, points: 5, streakDays: 1, streakBonus: 0, recordedDate: '2026-03-01',
		}).run();

		const unlocked = checkAndUnlockAchievements(1);
		const scout = unlocked.find((a) => a.code === 'category_scout');
		expect(scout).toBeDefined();
		expect(scout?.milestoneValue).toBe(2);
	});

	it('1カテゴリのみでは category_scout は解除されない', () => {
		testDb.insert(schema.activityLogs).values({
			childId: 1, activityId: 1, points: 5, streakDays: 1, streakBonus: 0, recordedDate: '2026-03-01',
		}).run();

		const unlocked = checkAndUnlockAchievements(1);
		const scout = unlocked.find((a) => a.code === 'category_scout');
		expect(scout).toBeUndefined();
	});

	it('3カテゴリで M=2 と M=3 を同時解除する', () => {
		testDb.insert(schema.activityLogs).values({
			childId: 1, activityId: 1, points: 5, streakDays: 1, streakBonus: 0, recordedDate: '2026-03-01',
		}).run();
		testDb.insert(schema.activityLogs).values({
			childId: 1, activityId: 2, points: 5, streakDays: 1, streakBonus: 0, recordedDate: '2026-03-01',
		}).run();
		testDb.insert(schema.activityLogs).values({
			childId: 1, activityId: 3, points: 5, streakDays: 1, streakBonus: 0, recordedDate: '2026-03-01',
		}).run();

		const unlocked = checkAndUnlockAchievements(1);
		const scouts = unlocked.filter((a) => a.code === 'category_scout');
		expect(scouts).toHaveLength(2);
		expect(scouts.map((s) => s.milestoneValue).sort()).toEqual([2, 3]);
	});
});
