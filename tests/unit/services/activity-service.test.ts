// tests/unit/services/activity-service.test.ts
// activity-service ユニットテスト (UT-ACT-01 〜 UT-ACT-10)

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

// ---- テスト用インメモリDB ----
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
	CREATE INDEX idx_activity_logs_streak ON activity_logs(child_id, activity_id, recorded_date);
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
	getActivities,
	getActivityById,
	createActivity,
	updateActivity,
	setActivityVisibility,
} from '../../../src/lib/server/services/activity-service';

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
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	// Reset autoincrement
	sqlite.exec("DELETE FROM sqlite_sequence WHERE name IN ('children', 'activities', 'activity_logs', 'point_ledger')");
}

function seedBase() {
	resetDb();
	testDb.insert(schema.children)
		.values({ nickname: 'テストちゃん', age: 4, theme: 'pink' })
		.run();

	const act = [
		{ name: 'たいそうした', category: 'うんどう', icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'おそとであそんだ', category: 'うんどう', icon: '🏃', basePoints: 5, sortOrder: 2 },
		{ name: 'すいみんぐ', category: 'うんどう', icon: '🏊', basePoints: 10, ageMin: 5, sortOrder: 3 },
		{ name: 'ひらがなれんしゅう', category: 'べんきょう', icon: '✏️', basePoints: 5, ageMin: 3, sortOrder: 4 },
		{ name: 'おかたづけした', category: 'せいかつ', icon: '🧹', basePoints: 5, sortOrder: 5 },
		{ name: '非表示活動', category: 'うんどう', icon: '❌', basePoints: 5, isVisible: 0, sortOrder: 99 },
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
	it('UT-ACT-01: 活動一覧取得（全件・非表示除外）', () => {
		const result = getActivities();
		// 非表示の1件を除く5件
		expect(result.length).toBe(5);
		expect(result.every((a) => a.isVisible === 1)).toBe(true);
	});

	// UT-ACT-02: 活動一覧取得（子供IDフィルタ）
	it('UT-ACT-02: 活動一覧取得（childAge フィルタ - 4歳）', () => {
		const result = getActivities({ childAge: 4 });
		// すいみんぐ(ageMin=5)は除外、非表示も除外 → 4件
		expect(result.length).toBe(4);
		expect(result.find((a) => a.name === 'すいみんぐ')).toBeUndefined();
	});

	// UT-ACT-03: 活動一覧取得（カテゴリフィルタ）
	it('UT-ACT-03: 活動一覧取得（カテゴリフィルタ）', () => {
		const result = getActivities({ category: 'うんどう' });
		// 非表示を除く うんどう = たいそう + おそと + すいみんぐ = 3件
		// すいみんぐ: ageMin=5 だが childAge 指定なしなのでageフィルタされない → 含む
		expect(result.length).toBe(3);
	});

	// UT-ACT-04: 活動一覧取得（非表示含む）
	it('UT-ACT-04: 活動一覧取得（非表示含む）', () => {
		const result = getActivities({ includeHidden: true });
		expect(result.length).toBe(6);
		expect(result.some((a) => a.isVisible === 0)).toBe(true);
	});

	// UT-ACT-05: 活動追加（正常）
	it('UT-ACT-05: 活動追加（正常）', () => {
		const result = createActivity({
			name: 'さんすうをした',
			category: 'べんきょう',
			icon: '🔢',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.id).toBeGreaterThan(0);
		expect(result.name).toBe('さんすうをした');
		expect(result.category).toBe('べんきょう');
		expect(result.basePoints).toBe(5);
		expect(result.isVisible).toBe(1);
	});

	// UT-ACT-07: 活動更新（正常）
	it('UT-ACT-07: 活動更新（正常）', () => {
		const updated = updateActivity(1, { name: 'ラジオたいそう' });
		expect(updated).toBeDefined();
		expect(updated!.name).toBe('ラジオたいそう');
	});

	// UT-ACT-08: 活動表示/非表示切替
	it('UT-ACT-08: 活動表示/非表示切替', () => {
		const hidden = setActivityVisibility(1, false);
		expect(hidden).toBeDefined();
		expect(hidden!.isVisible).toBe(0);

		const shown = setActivityVisibility(1, true);
		expect(shown).toBeDefined();
		expect(shown!.isVisible).toBe(1);
	});

	// UT-ACT-09: 年齢範囲フィルタ
	it('UT-ACT-09: 年齢範囲フィルタ（5歳以上の活動、4歳の子供）', () => {
		const result = getActivities({ childAge: 4 });
		expect(result.find((a) => a.name === 'すいみんぐ')).toBeUndefined();

		const result5 = getActivities({ childAge: 5 });
		expect(result5.find((a) => a.name === 'すいみんぐ')).toBeDefined();
	});

	it('getActivityById: 存在する活動を返す', () => {
		const result = getActivityById(1);
		expect(result).toBeDefined();
		expect(result!.name).toBe('たいそうした');
	});

	it('getActivityById: 存在しない場合は undefined', () => {
		const result = getActivityById(999);
		expect(result).toBeUndefined();
	});
});
