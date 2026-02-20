// tests/unit/services/evaluation-service.test.ts
// 週次評価サービスのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
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
	CREATE INDEX idx_status_history_child_cat ON status_history(child_id, category, recorded_at);
	CREATE TABLE evaluations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		week_start TEXT NOT NULL, week_end TEXT NOT NULL,
		scores_json TEXT NOT NULL, bonus_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL, category TEXT NOT NULL,
		mean REAL NOT NULL, std_dev REAL NOT NULL,
		source TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category);
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
	get db() { return testDb; },
}));
vi.mock('$lib/server/db/client', () => ({
	get db() { return testDb; },
}));

import {
	calcStatusIncrease,
	calcEvaluationBonus,
	getWeekRange,
	evaluateChild,
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
	testDb.insert(schema.children)
		.values({ nickname: 'テストちゃん', age: 4, theme: 'pink' })
		.run();

	// 5カテゴリに1つずつ活動を用意
	const acts = [
		{ name: 'たいそう', category: 'うんどう', icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'ひらがな', category: 'べんきょう', icon: '✏️', basePoints: 5, sortOrder: 2 },
		{ name: 'おかたづけ', category: 'せいかつ', icon: '🧹', basePoints: 5, sortOrder: 3 },
		{ name: 'おともだち', category: 'こうりゅう', icon: '🤝', basePoints: 5, sortOrder: 4 },
		{ name: 'おえかき', category: 'そうぞう', icon: '🎨', basePoints: 5, sortOrder: 5 },
	];
	for (const a of acts) {
		testDb.insert(schema.activities).values(a).run();
	}
}

function addLog(childId: number, activityId: number, date: string) {
	testDb.insert(schema.activityLogs)
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
	it('7回以上で+3.0', () => {
		expect(calcStatusIncrease(7)).toBe(3.0);
		expect(calcStatusIncrease(10)).toBe(3.0);
	});

	it('5-6回で+2.0', () => {
		expect(calcStatusIncrease(5)).toBe(2.0);
		expect(calcStatusIncrease(6)).toBe(2.0);
	});

	it('3-4回で+1.0', () => {
		expect(calcStatusIncrease(3)).toBe(1.0);
		expect(calcStatusIncrease(4)).toBe(1.0);
	});

	it('1-2回で+0.5', () => {
		expect(calcStatusIncrease(1)).toBe(0.5);
		expect(calcStatusIncrease(2)).toBe(0.5);
	});

	it('0回で0', () => {
		expect(calcStatusIncrease(0)).toBe(0);
	});
});

describe('calcEvaluationBonus', () => {
	it('5カテゴリ活動で20P', () => {
		const scores = {
			'うんどう': { count: 1, points: 5 },
			'べんきょう': { count: 1, points: 5 },
			'せいかつ': { count: 1, points: 5 },
			'こうりゅう': { count: 1, points: 5 },
			'そうぞう': { count: 1, points: 5 },
		};
		expect(calcEvaluationBonus(scores)).toBe(20);
	});

	it('4カテゴリ活動で10P', () => {
		const scores = {
			'うんどう': { count: 1, points: 5 },
			'べんきょう': { count: 1, points: 5 },
			'せいかつ': { count: 1, points: 5 },
			'こうりゅう': { count: 1, points: 5 },
			'そうぞう': { count: 0, points: 0 },
		};
		expect(calcEvaluationBonus(scores)).toBe(10);
	});

	it('3カテゴリ活動で5P', () => {
		const scores = {
			'うんどう': { count: 1, points: 5 },
			'べんきょう': { count: 1, points: 5 },
			'せいかつ': { count: 1, points: 5 },
			'こうりゅう': { count: 0, points: 0 },
			'そうぞう': { count: 0, points: 0 },
		};
		expect(calcEvaluationBonus(scores)).toBe(5);
	});

	it('2カテゴリ以下は0P', () => {
		const scores = {
			'うんどう': { count: 1, points: 5 },
			'べんきょう': { count: 1, points: 5 },
			'せいかつ': { count: 0, points: 0 },
			'こうりゅう': { count: 0, points: 0 },
			'そうぞう': { count: 0, points: 0 },
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

	it('活動なしの週は全カテゴリ0', () => {
		const result = evaluateChild(1, '2026-02-16', '2026-02-22');
		expect(result.childId).toBe(1);
		expect(result.bonusPoints).toBe(0);
		for (const cat of Object.values(result.categoryScores)) {
			expect(cat.count).toBe(0);
			expect(cat.statusIncrease).toBe(0);
		}
	});

	it('各カテゴリ1回ずつ活動で全カテゴリボーナス', () => {
		// 月〜金に各カテゴリ1回ずつ
		addLog(1, 1, '2026-02-16'); // うんどう
		addLog(1, 2, '2026-02-17'); // べんきょう
		addLog(1, 3, '2026-02-18'); // せいかつ
		addLog(1, 4, '2026-02-19'); // こうりゅう
		addLog(1, 5, '2026-02-20'); // そうぞう

		const result = evaluateChild(1, '2026-02-16', '2026-02-22');
		expect(result.bonusPoints).toBe(20); // 5カテゴリ活動ボーナス

		// 各カテゴリ +0.5（1回活動）
		for (const cat of Object.values(result.categoryScores)) {
			expect(cat.count).toBe(1);
			expect(cat.statusIncrease).toBe(0.5);
		}
	});

	it('1カテゴリ7回でステータス+3.0', () => {
		for (let i = 16; i <= 22; i++) {
			addLog(1, 1, `2026-02-${i}`); // うんどう毎日
		}

		const result = evaluateChild(1, '2026-02-16', '2026-02-22');
		expect(result.categoryScores['うんどう']!.count).toBe(7);
		expect(result.categoryScores['うんどう']!.statusIncrease).toBe(3.0);
	});
});

describe('runDailyDecay', () => {
	beforeEach(() => {
		seedBase();
	});

	it('活動履歴なしの場合は減少なし', () => {
		const results = runDailyDecay('2026-02-21');
		expect(results[0]!.decays.length).toBe(0);
	});

	it('前日に活動があれば減少が発生', () => {
		addLog(1, 1, '2026-02-19'); // 2日前にうんどう

		const results = runDailyDecay('2026-02-21');
		const decay = results[0]!.decays.find((d) => d.category === 'うんどう');
		expect(decay).toBeDefined();
		expect(decay!.amount).toBeGreaterThan(0);
	});
});
