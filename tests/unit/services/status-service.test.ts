// tests/unit/services/status-service.test.ts
// ステータスサービスのユニットテスト

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
	getChildStatus,
	updateStatus,
} from '../../../src/lib/server/services/status-service';

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
	sqlite.exec('DELETE FROM status_history');
	sqlite.exec('DELETE FROM statuses');
	sqlite.exec('DELETE FROM market_benchmarks');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children', 'statuses', 'status_history', 'market_benchmarks')",
	);
}

function seedChild() {
	resetDb();
	testDb.insert(schema.children)
		.values({ nickname: 'テストちゃん', age: 4, theme: 'pink' })
		.run();
}

function seedBenchmarks() {
	const categories = ['うんどう', 'べんきょう', 'せいかつ', 'こうりゅう', 'そうぞう'];
	for (const cat of categories) {
		testDb.insert(schema.marketBenchmarks)
			.values({ age: 4, category: cat, mean: 50, stdDev: 10, source: 'test' })
			.run();
	}
}

describe('status-service', () => {
	beforeEach(() => {
		seedChild();
	});

	it('存在しない子供はNOT_FOUND', () => {
		const result = getChildStatus(999);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('初期状態で全カテゴリ値0のステータスを返す', () => {
		const result = getChildStatus(1);
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.childId).toBe(1);
			expect(result.level).toBe(1);
			expect(result.levelTitle).toBe('はじめのぼうけんしゃ');
			expect(Object.keys(result.statuses).length).toBe(5);
			expect(result.statuses['うんどう']!.value).toBe(0);
		}
	});

	it('ベンチマークなしの場合、偏差値50を返す', () => {
		const result = getChildStatus(1);
		if (!('error' in result)) {
			expect(result.statuses['うんどう']!.deviationScore).toBe(50);
			expect(result.statuses['うんどう']!.stars).toBe(3);
		}
	});

	it('ベンチマークありの場合、偏差値を正しく計算する', () => {
		seedBenchmarks();
		// うんどう = 70, mean = 50, stdDev = 10 → 偏差値 (70-50)/10*10+50 = 70
		updateStatus(1, 'うんどう', 70, 'test');

		const result = getChildStatus(1);
		if (!('error' in result)) {
			expect(result.statuses['うんどう']!.value).toBe(70);
			expect(result.statuses['うんどう']!.deviationScore).toBe(70);
			expect(result.statuses['うんどう']!.stars).toBe(5);
		}
	});

	it('ステータス更新が正常に動作する', () => {
		const updated = updateStatus(1, 'うんどう', 5.0, 'weekly');
		expect(updated).toBeDefined();
		if (updated && !('error' in updated)) {
			expect(updated.value).toBe(5.0);
		}

		// 累積更新
		const updated2 = updateStatus(1, 'うんどう', 3.0, 'weekly');
		if (updated2 && !('error' in updated2)) {
			expect(updated2.value).toBe(8.0);
		}
	});

	it('ステータスは0未満にならない', () => {
		updateStatus(1, 'うんどう', 5.0, 'weekly');
		const updated = updateStatus(1, 'うんどう', -10.0, 'decay');
		if (updated && !('error' in updated)) {
			expect(updated.value).toBe(0);
		}
	});

	it('ステータスは100を超えない', () => {
		updateStatus(1, 'うんどう', 95.0, 'weekly');
		const updated = updateStatus(1, 'うんどう', 20.0, 'weekly');
		if (updated && !('error' in updated)) {
			expect(updated.value).toBe(100);
		}
	});

	it('レベルがステータス平均で決まる', () => {
		// 全カテゴリを50に設定 → 平均50 → レベル6
		for (const cat of ['うんどう', 'べんきょう', 'せいかつ', 'こうりゅう', 'そうぞう']) {
			updateStatus(1, cat, 50, 'test');
		}

		const result = getChildStatus(1);
		if (!('error' in result)) {
			expect(result.level).toBe(6);
			expect(result.levelTitle).toBe('すごうでアドベンチャー');
		}
	});

	it('キャラクタータイプが偏差値平均で決まる', () => {
		seedBenchmarks();
		// 全カテゴリを70に → 偏差値70 → hero
		for (const cat of ['うんどう', 'べんきょう', 'せいかつ', 'こうりゅう', 'そうぞう']) {
			updateStatus(1, cat, 70, 'test');
		}

		const result = getChildStatus(1);
		if (!('error' in result)) {
			expect(result.characterType).toBe('hero');
		}
	});

	it('存在しない子供のステータス更新はNOT_FOUND', () => {
		const result = updateStatus(999, 'うんどう', 5.0, 'weekly');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});
});
