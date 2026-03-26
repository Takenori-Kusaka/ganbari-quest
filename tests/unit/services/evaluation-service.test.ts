// tests/unit/services/evaluation-service.test.ts
// 週次評価サービスのユニットテスト

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
	CREATE INDEX idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date);
	CREATE INDEX idx_activity_logs_child_date ON activity_logs(child_id, recorded_date);
	CREATE INDEX idx_activity_logs_activity ON activity_logs(activity_id);
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
	CREATE INDEX idx_status_history_child_cat ON status_history(child_id, category_id, recorded_at);
	CREATE TABLE evaluations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		week_start TEXT NOT NULL, week_end TEXT NOT NULL,
		scores_json TEXT NOT NULL, bonus_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id),
		mean REAL NOT NULL, std_dev REAL NOT NULL,
		source TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category_id);
	CREATE TABLE settings (
		key TEXT PRIMARY KEY, value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE character_images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		type TEXT NOT NULL, file_path TEXT NOT NULL,
		prompt_hash TEXT,
		generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE login_bonuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		login_date TEXT NOT NULL, rank TEXT NOT NULL,
		base_points INTEGER NOT NULL, multiplier REAL NOT NULL DEFAULT 1.0,
		total_points INTEGER NOT NULL, consecutive_days INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_login_bonuses_child_date ON login_bonuses(child_id, login_date);
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

import {
	calcEvaluationBonus,
	calcStatusIncrease,
	evaluateChild,
	getWeekRange,
	runDailyDecay,
} from '../../../src/lib/server/services/evaluation-service';

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
	sqlite.exec('DELETE FROM evaluations');
	sqlite.exec('DELETE FROM status_history');
	sqlite.exec('DELETE FROM statuses');
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','activities','activity_logs','point_ledger','statuses','status_history','evaluations')",
	);
}

function seedBase() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();

	// 5カテゴリに1つずつ活動を用意
	const acts = [
		{ name: 'たいそう', categoryId: 1, icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'ひらがな', categoryId: 2, icon: '✏️', basePoints: 5, sortOrder: 2 },
		{ name: 'おかたづけ', categoryId: 3, icon: '🧹', basePoints: 5, sortOrder: 3 },
		{ name: 'おともだち', categoryId: 4, icon: '🤝', basePoints: 5, sortOrder: 4 },
		{ name: 'おえかき', categoryId: 5, icon: '🎨', basePoints: 5, sortOrder: 5 },
	];
	for (const a of acts) {
		testDb.insert(schema.activities).values(a).run();
	}
}

function addLog(childId: number, activityId: number, date: string) {
	testDb
		.insert(schema.activityLogs)
		.values({
			childId,
			activityId,
			points: 5,
			streakDays: 1,
			streakBonus: 0,
			recordedDate: date,
		})
		.run();
}

describe('calcStatusIncrease', () => {
	it('7回以上で+1.0（週次ボーナス）', () => {
		expect(calcStatusIncrease(7)).toBe(1.0);
		expect(calcStatusIncrease(10)).toBe(1.0);
	});

	it('5-6回で+0.5', () => {
		expect(calcStatusIncrease(5)).toBe(0.5);
		expect(calcStatusIncrease(6)).toBe(0.5);
	});

	it('3-4回で+0.3', () => {
		expect(calcStatusIncrease(3)).toBe(0.3);
		expect(calcStatusIncrease(4)).toBe(0.3);
	});

	it('0-2回で0（即時更新分で十分）', () => {
		expect(calcStatusIncrease(0)).toBe(0);
		expect(calcStatusIncrease(1)).toBe(0);
		expect(calcStatusIncrease(2)).toBe(0);
	});
});

describe('calcEvaluationBonus', () => {
	it('5カテゴリ活動で20P', () => {
		const scores = {
			うんどう: { count: 1, points: 5 },
			べんきょう: { count: 1, points: 5 },
			せいかつ: { count: 1, points: 5 },
			こうりゅう: { count: 1, points: 5 },
			そうぞう: { count: 1, points: 5 },
		};
		expect(calcEvaluationBonus(scores)).toBe(20);
	});

	it('4カテゴリ活動で10P', () => {
		const scores = {
			うんどう: { count: 1, points: 5 },
			べんきょう: { count: 1, points: 5 },
			せいかつ: { count: 1, points: 5 },
			こうりゅう: { count: 1, points: 5 },
			そうぞう: { count: 0, points: 0 },
		};
		expect(calcEvaluationBonus(scores)).toBe(10);
	});

	it('3カテゴリ活動で5P', () => {
		const scores = {
			うんどう: { count: 1, points: 5 },
			べんきょう: { count: 1, points: 5 },
			せいかつ: { count: 1, points: 5 },
			こうりゅう: { count: 0, points: 0 },
			そうぞう: { count: 0, points: 0 },
		};
		expect(calcEvaluationBonus(scores)).toBe(5);
	});

	it('2カテゴリ以下は0P', () => {
		const scores = {
			うんどう: { count: 1, points: 5 },
			べんきょう: { count: 1, points: 5 },
			せいかつ: { count: 0, points: 0 },
			こうりゅう: { count: 0, points: 0 },
			そうぞう: { count: 0, points: 0 },
		};
		expect(calcEvaluationBonus(scores)).toBe(0);
	});
});

describe('getWeekRange', () => {
	it('日曜日の場合、その週の月〜日を返す', () => {
		// 2026-02-22 は日曜日
		const { weekStart, weekEnd } = getWeekRange(new Date('2026-02-22'));
		expect(weekStart).toBe('2026-02-16');
		expect(weekEnd).toBe('2026-02-22');
	});

	it('水曜日の場合、前週の月〜日を返す', () => {
		// 2026-02-25 は水曜日
		const { weekStart, weekEnd } = getWeekRange(new Date('2026-02-25'));
		expect(weekStart).toBe('2026-02-16');
		expect(weekEnd).toBe('2026-02-22');
	});
});

describe('evaluateChild', () => {
	beforeEach(() => {
		seedBase();
	});

	it('活動なしの週は全カテゴリ0', async () => {
		const result = await evaluateChild(1, '2026-02-16', '2026-02-22', 'test-tenant');
		expect(result.childId).toBe(1);
		expect(result.bonusPoints).toBe(0);
		for (const cat of Object.values(result.categoryScores)) {
			expect(cat.count).toBe(0);
			expect(cat.statusIncrease).toBe(0);
		}
	});

	it('各カテゴリ1回ずつ活動で全カテゴリボーナス', async () => {
		// 月〜金に各カテゴリ1回ずつ
		addLog(1, 1, '2026-02-16'); // うんどう
		addLog(1, 2, '2026-02-17'); // べんきょう
		addLog(1, 3, '2026-02-18'); // せいかつ
		addLog(1, 4, '2026-02-19'); // こうりゅう
		addLog(1, 5, '2026-02-20'); // そうぞう

		const result = await evaluateChild(1, '2026-02-16', '2026-02-22', 'test-tenant');
		expect(result.bonusPoints).toBe(20); // 5カテゴリ活動ボーナス

		// 各カテゴリ1回→週次ボーナスなし（即時更新分で十分）
		for (const cat of Object.values(result.categoryScores)) {
			expect(cat.count).toBe(1);
			expect(cat.statusIncrease).toBe(0);
		}
	});

	it('1カテゴリ7回でステータス+3.0', async () => {
		for (let i = 16; i <= 22; i++) {
			addLog(1, 1, `2026-02-${i}`); // うんどう毎日
		}

		const result = await evaluateChild(1, '2026-02-16', '2026-02-22', 'test-tenant');
		expect(result.categoryScores[1]?.count).toBe(7);
		expect(result.categoryScores[1]?.statusIncrease).toBe(1.0); // 週次ボーナス
	});
});

describe('runDailyDecay', () => {
	beforeEach(() => {
		seedBase();
	});

	it('活動履歴なしの場合は減少なし', async () => {
		const results = await runDailyDecay('test-tenant', '2026-02-21');
		expect(results[0]?.decays.length).toBe(0);
	});

	it('前日に活動があれば減少が発生', async () => {
		addLog(1, 1, '2026-02-19'); // 2日前にうんどう

		const results = await runDailyDecay('test-tenant', '2026-02-21');
		const decay = results[0]?.decays.find((d) => d.categoryId === 1);
		expect(decay).toBeDefined();
		expect(decay?.amount).toBeGreaterThan(0);
	});
});
