// tests/helpers/test-db.ts
// テスト用インメモリ SQLite + Drizzle セットアップ

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/lib/server/db/schema';

const SQL_CREATE_TABLES = `
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL,
		age INTEGER NOT NULL,
		birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		category TEXT NOT NULL,
		icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		age_min INTEGER,
		age_max INTEGER,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER,
		sort_order INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'seed',
		grade_level TEXT,
		subcategory TEXT,
		description TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		points INTEGER NOT NULL,
		streak_days INTEGER NOT NULL DEFAULT 1,
		streak_bonus INTEGER NOT NULL DEFAULT 0,
		recorded_date TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		cancelled INTEGER NOT NULL DEFAULT 0
	);
	CREATE UNIQUE INDEX idx_activity_logs_unique_daily
		ON activity_logs(child_id, activity_id, recorded_date);
	CREATE INDEX idx_activity_logs_child_date
		ON activity_logs(child_id, recorded_date);
	CREATE INDEX idx_activity_logs_activity
		ON activity_logs(activity_id);
	CREATE INDEX idx_activity_logs_streak
		ON activity_logs(child_id, activity_id, recorded_date);

	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL,
		type TEXT NOT NULL,
		description TEXT,
		reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_point_ledger_child ON point_ledger(child_id, created_at);

	CREATE TABLE statuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category TEXT NOT NULL,
		value REAL NOT NULL DEFAULT 0.0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category);

	CREATE TABLE status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category TEXT NOT NULL,
		value REAL NOT NULL,
		change_amount REAL NOT NULL,
		change_type TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_status_history_child_cat
		ON status_history(child_id, category, recorded_at);

	CREATE TABLE evaluations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		week_start TEXT NOT NULL,
		week_end TEXT NOT NULL,
		scores_json TEXT NOT NULL,
		bonus_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL,
		category TEXT NOT NULL,
		mean REAL NOT NULL,
		std_dev REAL NOT NULL,
		source TEXT,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category
		ON market_benchmarks(age, category);

	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE character_images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		type TEXT NOT NULL,
		file_path TEXT NOT NULL,
		prompt_hash TEXT,
		generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE login_bonuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		login_date TEXT NOT NULL,
		rank TEXT NOT NULL,
		base_points INTEGER NOT NULL,
		multiplier REAL NOT NULL DEFAULT 1.0,
		total_points INTEGER NOT NULL,
		consecutive_days INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_login_bonuses_child_date
		ON login_bonuses(child_id, login_date);

	CREATE TABLE achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		description TEXT,
		icon TEXT NOT NULL,
		category TEXT,
		condition_type TEXT NOT NULL,
		condition_value INTEGER NOT NULL,
		bonus_points INTEGER NOT NULL,
		rarity TEXT NOT NULL DEFAULT 'common',
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

	CREATE TABLE special_rewards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		granted_by INTEGER,
		title TEXT NOT NULL,
		description TEXT,
		points INTEGER NOT NULL,
		icon TEXT,
		category TEXT NOT NULL,
		granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_special_rewards_child
		ON special_rewards(child_id, granted_at);
`;

export function createTestDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_CREATE_TABLES);
	const db = drizzle(sqlite, { schema });
	return { sqlite, db, schema };
}

/** テスト用の認証設定を挿入する */
export function seedAuthSettings(db: ReturnType<typeof drizzle>, pinHash: string) {
	db.insert(schema.settings)
		.values([
			{ key: 'pin_hash', value: pinHash },
			{ key: 'session_token', value: '' },
			{ key: 'session_expires_at', value: '' },
			{ key: 'pin_failed_attempts', value: '0' },
			{ key: 'pin_locked_until', value: '' },
		])
		.run();
}

/** テスト用の子供と活動を挿入する */
export function seedTestData(db: ReturnType<typeof drizzle>) {
	// 子供
	db.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();

	// 活動マスタ
	const activitiesData = [
		{ name: 'たいそうした', category: 'うんどう', icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'おそとであそんだ', category: 'うんどう', icon: '🏃', basePoints: 5, sortOrder: 2 },
		{
			name: 'すいみんぐ',
			category: 'うんどう',
			icon: '🏊',
			basePoints: 10,
			ageMin: 3,
			sortOrder: 3,
		},
		{
			name: 'ひらがなれんしゅう',
			category: 'べんきょう',
			icon: '✏️',
			basePoints: 5,
			ageMin: 3,
			sortOrder: 4,
		},
		{ name: 'おかたづけした', category: 'せいかつ', icon: '🧹', basePoints: 5, sortOrder: 5 },
		{ name: 'おえかきした', category: 'そうぞう', icon: '🎨', basePoints: 5, sortOrder: 6 },
		{
			name: 'おともだちとあそんだ',
			category: 'こうりゅう',
			icon: '🤝',
			basePoints: 5,
			sortOrder: 7,
		},
		{
			name: '5さいいじょう活動',
			category: 'べんきょう',
			icon: '📚',
			basePoints: 5,
			ageMin: 5,
			sortOrder: 8,
		},
		{
			name: '非表示活動',
			category: 'うんどう',
			icon: '❌',
			basePoints: 5,
			isVisible: 0,
			sortOrder: 99,
		},
	];

	for (const a of activitiesData) {
		db.insert(schema.activities).values(a).run();
	}

	return {
		childId: 1,
		activityIds: {
			taisou: 1,
			osoto: 2,
			swimming: 3,
			hiragana: 4,
			okataduke: 5,
			oekaki: 6,
			otomodachi: 7,
			fiveAndUp: 8,
			hidden: 9,
		},
	};
}
