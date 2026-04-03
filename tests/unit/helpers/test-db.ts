// tests/unit/helpers/test-db.ts
// Shared test database helper — single source of truth for test DB schema SQL.
// Replaces duplicated SQL_TABLES strings across all service unit tests.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../src/lib/server/db/schema';

// ============================================================
// Types
// ============================================================

export type TestSqlite = InstanceType<typeof Database>;
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDatabase {
	sqlite: TestSqlite;
	db: TestDb;
}

// ============================================================
// Comprehensive SQL schema — superset of all tables used across
// every service test file. Kept in sync with src/lib/server/db/schema.ts.
// ============================================================

export const SQL_TABLES = `
	-- ============================================================
	-- categories (master + seed data)
	-- ============================================================
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

	-- ============================================================
	-- titles (master)
	-- ============================================================
	CREATE TABLE titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		description TEXT,
		icon TEXT NOT NULL,
		condition_type TEXT NOT NULL,
		condition_value INTEGER NOT NULL,
		condition_extra TEXT,
		rarity TEXT NOT NULL DEFAULT 'common',
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- ============================================================
	-- children
	-- ============================================================
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL,
		age INTEGER NOT NULL,
		birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		active_title_id INTEGER,
		display_config TEXT,
		user_id TEXT,
		birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
		last_birthday_bonus_year INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER
	);

	-- ============================================================
	-- activities
	-- ============================================================
	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		category_id INTEGER NOT NULL REFERENCES categories(id),
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
		name_kana TEXT,
		name_kanji TEXT,
		trigger_hint TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- ============================================================
	-- activity_logs
	-- ============================================================
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
	CREATE INDEX idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date);
	CREATE INDEX idx_activity_logs_child_date ON activity_logs(child_id, recorded_date);
	CREATE INDEX idx_activity_logs_activity ON activity_logs(activity_id);
	CREATE INDEX idx_activity_logs_streak ON activity_logs(child_id, activity_id, recorded_date);

	-- ============================================================
	-- point_ledger
	-- ============================================================
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

	-- ============================================================
	-- statuses
	-- ============================================================
	CREATE TABLE statuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id),
		total_xp INTEGER NOT NULL DEFAULT 0,
		level INTEGER NOT NULL DEFAULT 1,
		peak_xp INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER
	);
	CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category_id);

	-- ============================================================
	-- status_history
	-- ============================================================
	CREATE TABLE status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id),
		value REAL NOT NULL,
		change_amount REAL NOT NULL,
		change_type TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_status_history_child_cat ON status_history(child_id, category_id, recorded_at);

	-- ============================================================
	-- evaluations
	-- ============================================================
	CREATE TABLE evaluations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		week_start TEXT NOT NULL,
		week_end TEXT NOT NULL,
		scores_json TEXT NOT NULL,
		bonus_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- ============================================================
	-- market_benchmarks
	-- ============================================================
	CREATE TABLE market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL,
		category_id INTEGER NOT NULL REFERENCES categories(id),
		mean REAL NOT NULL,
		std_dev REAL NOT NULL,
		source TEXT,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category_id);

	-- ============================================================
	-- settings
	-- ============================================================
	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- ============================================================
	-- rest_days
	-- ============================================================
	CREATE TABLE rest_days (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		date TEXT NOT NULL,
		reason TEXT NOT NULL DEFAULT 'rest',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_rest_days_child_date ON rest_days(child_id, date);

	-- ============================================================
	-- character_images
	-- ============================================================
	CREATE TABLE character_images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		type TEXT NOT NULL,
		file_path TEXT NOT NULL,
		prompt_hash TEXT,
		generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- ============================================================
	-- login_bonuses
	-- ============================================================
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
	CREATE UNIQUE INDEX idx_login_bonuses_child_date ON login_bonuses(child_id, login_date);

	-- ============================================================
	-- achievements
	-- ============================================================
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
		repeatable INTEGER NOT NULL DEFAULT 0,
		milestone_values TEXT,
		is_milestone INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- ============================================================
	-- child_achievements
	-- ============================================================
	CREATE TABLE child_achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		achievement_id INTEGER NOT NULL REFERENCES achievements(id),
		milestone_value INTEGER,
		unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_child_achievements_unique
		ON child_achievements(child_id, achievement_id, milestone_value);

	-- ============================================================
	-- special_rewards
	-- ============================================================
	CREATE TABLE special_rewards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		granted_by INTEGER,
		title TEXT NOT NULL,
		description TEXT,
		points INTEGER NOT NULL,
		icon TEXT,
		category TEXT NOT NULL,
		granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		shown_at TEXT
	);
	CREATE INDEX idx_special_rewards_child ON special_rewards(child_id, granted_at);

	-- ============================================================
	-- daily_missions
	-- ============================================================
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

	-- ============================================================
	-- child_titles
	-- ============================================================
	CREATE TABLE child_titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		title_id INTEGER NOT NULL REFERENCES titles(id),
		unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_child_titles_unique ON child_titles(child_id, title_id);

	-- ============================================================
	-- parent_messages
	-- ============================================================
	CREATE TABLE parent_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		message_type TEXT NOT NULL,
		stamp_code TEXT,
		body TEXT,
		icon TEXT NOT NULL DEFAULT '💌',
		sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		shown_at TEXT
	);
	CREATE INDEX idx_parent_messages_child ON parent_messages(child_id, sent_at);
	CREATE INDEX idx_parent_messages_unshown ON parent_messages(child_id, shown_at);

	-- ============================================================
	-- child_custom_voices
	-- ============================================================
	CREATE TABLE child_custom_voices (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL,
		scene TEXT NOT NULL DEFAULT 'complete',
		label TEXT NOT NULL,
		file_path TEXT NOT NULL,
		public_url TEXT NOT NULL,
		duration_ms INTEGER,
		is_active INTEGER NOT NULL DEFAULT 0,
		tenant_id TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_child_custom_voices_child ON child_custom_voices(child_id, scene);

	-- ============================================================
	-- level_titles
	-- ============================================================
	CREATE TABLE level_titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		level INTEGER NOT NULL,
		custom_title TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_level_titles_tenant_level ON level_titles(tenant_id, level);

	-- ============================================================
	-- checklist_templates
	-- ============================================================
	CREATE TABLE checklist_templates (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '📋',
		points_per_item INTEGER NOT NULL DEFAULT 2,
		completion_bonus INTEGER NOT NULL DEFAULT 5,
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- ============================================================
	-- checklist_template_items
	-- ============================================================
	CREATE TABLE checklist_template_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
		name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '🏫',
		frequency TEXT NOT NULL DEFAULT 'daily',
		direction TEXT NOT NULL DEFAULT 'bring',
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_checklist_items_template ON checklist_template_items(template_id);

	-- ============================================================
	-- checklist_logs
	-- ============================================================
	CREATE TABLE checklist_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
		checked_date TEXT NOT NULL,
		items_json TEXT NOT NULL DEFAULT '[]',
		completed_all INTEGER NOT NULL DEFAULT 0,
		points_awarded INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_checklist_logs_unique_daily ON checklist_logs(child_id, template_id, checked_date);

	-- ============================================================
	-- checklist_overrides
	-- ============================================================
	CREATE TABLE checklist_overrides (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		target_date TEXT NOT NULL,
		action TEXT NOT NULL,
		item_name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '📦',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_checklist_overrides_child_date ON checklist_overrides(child_id, target_date);

	-- ============================================================
	-- child_activity_preferences
	-- ============================================================
	CREATE TABLE child_activity_preferences (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		is_pinned INTEGER NOT NULL DEFAULT 0,
		pin_order INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_child_activity_prefs_unique ON child_activity_preferences(child_id, activity_id);

	-- ============================================================
	-- stamp_masters
	-- ============================================================
	CREATE TABLE stamp_masters (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		emoji TEXT NOT NULL,
		rarity TEXT NOT NULL,
		is_default INTEGER NOT NULL DEFAULT 1,
		is_enabled INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (1, 'にこにこ', '😊', 'N');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (2, 'グッジョブ', '👍', 'N');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (3, 'スター', '⭐', 'N');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (4, 'ハート', '❤️', 'N');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (5, 'がんばった', '💪', 'N');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (6, 'ロケット', '🚀', 'R');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (7, 'おうかん', '👑', 'R');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (8, 'トロフィー', '🏆', 'R');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (9, 'にじ', '🌈', 'R');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (10, 'たいよう', '☀️', 'R');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (11, 'ドラゴン', '🐉', 'SR');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (12, 'ユニコーン', '🦄', 'SR');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (13, 'たからばこ', '📦', 'SR');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (14, 'まほうのつえ', '🪄', 'SR');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (15, 'でんせつのけん', '⚔️', 'UR');
	INSERT OR IGNORE INTO stamp_masters (id, name, emoji, rarity) VALUES (16, 'きせきのほし', '🌟', 'UR');

	-- ============================================================
	-- stamp_cards
	-- ============================================================
	CREATE TABLE stamp_cards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		week_start TEXT NOT NULL,
		week_end TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'collecting',
		redeemed_points INTEGER,
		redeemed_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_stamp_cards_child_week ON stamp_cards(child_id, week_start);

	-- ============================================================
	-- stamp_entries
	-- ============================================================
	CREATE TABLE stamp_entries (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		card_id INTEGER NOT NULL REFERENCES stamp_cards(id),
		stamp_master_id INTEGER REFERENCES stamp_masters(id),
		omikuji_rank TEXT,
		slot INTEGER NOT NULL,
		login_date TEXT NOT NULL,
		earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_stamp_entries_card_slot ON stamp_entries(card_id, slot);

	-- ============================================================
	-- activity_mastery
	-- ============================================================
	CREATE TABLE activity_mastery (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		total_count INTEGER NOT NULL DEFAULT 0,
		level INTEGER NOT NULL DEFAULT 1,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_activity_mastery_child_activity ON activity_mastery(child_id, activity_id);

	-- ============================================================
	-- sibling_challenges
	-- ============================================================
	CREATE TABLE sibling_challenges (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		description TEXT,
		challenge_type TEXT NOT NULL DEFAULT 'cooperative',
		period_type TEXT NOT NULL DEFAULT 'weekly',
		start_date TEXT NOT NULL,
		end_date TEXT NOT NULL,
		target_config TEXT NOT NULL,
		reward_config TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'active',
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_sibling_challenges_status ON sibling_challenges(status);
	CREATE INDEX idx_sibling_challenges_dates ON sibling_challenges(start_date, end_date);

	-- ============================================================
	-- sibling_challenge_progress
	-- ============================================================
	CREATE TABLE sibling_challenge_progress (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		challenge_id INTEGER NOT NULL REFERENCES sibling_challenges(id) ON DELETE CASCADE,
		child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		current_value INTEGER NOT NULL DEFAULT 0,
		target_value INTEGER NOT NULL,
		completed INTEGER NOT NULL DEFAULT 0,
		completed_at TEXT,
		reward_claimed INTEGER NOT NULL DEFAULT 0,
		reward_claimed_at TEXT,
		progress_json TEXT,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_sibling_challenge_progress_unique ON sibling_challenge_progress(challenge_id, child_id);
	CREATE INDEX idx_sibling_challenge_progress_child ON sibling_challenge_progress(child_id);

	-- sibling_cheers
	CREATE TABLE sibling_cheers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		from_child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		to_child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		stamp_code TEXT NOT NULL,
		tenant_id TEXT NOT NULL DEFAULT 'default',
		sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		shown_at TEXT
	);
	CREATE INDEX idx_sibling_cheers_to_shown ON sibling_cheers(to_child_id, shown_at);

	-- ============================================================
	-- push_subscriptions
	-- ============================================================
	CREATE TABLE push_subscriptions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		endpoint TEXT NOT NULL UNIQUE,
		keys_p256dh TEXT NOT NULL,
		keys_auth TEXT NOT NULL,
		user_agent TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_push_subs_tenant ON push_subscriptions(tenant_id);

	-- ============================================================
	-- notification_logs
	-- ============================================================
	CREATE TABLE notification_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		notification_type TEXT NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL,
		sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		success INTEGER NOT NULL DEFAULT 1,
		error_message TEXT
	);
	CREATE INDEX idx_notification_logs_tenant_date ON notification_logs(tenant_id, sent_at);

	-- report_daily_summaries
	CREATE TABLE report_daily_summaries (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		child_id INTEGER NOT NULL REFERENCES children(id),
		date TEXT NOT NULL,
		activity_count INTEGER NOT NULL DEFAULT 0,
		category_breakdown TEXT NOT NULL DEFAULT '{}',
		checklist_completion TEXT NOT NULL DEFAULT '{}',
		level INTEGER NOT NULL DEFAULT 1,
		total_points INTEGER NOT NULL DEFAULT 0,
		streak_days INTEGER NOT NULL DEFAULT 0,
		new_achievements INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(tenant_id, child_id, date)
	);
	CREATE INDEX idx_report_daily_child_date ON report_daily_summaries(child_id, date);
	CREATE INDEX idx_report_daily_tenant_date ON report_daily_summaries(tenant_id, date);

	-- certificates
	CREATE TABLE certificates (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		tenant_id TEXT NOT NULL,
		certificate_type TEXT NOT NULL,
		title TEXT NOT NULL,
		description TEXT,
		issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		metadata TEXT,
		UNIQUE(child_id, tenant_id, certificate_type)
	);
	CREATE INDEX idx_certificates_child ON certificates(child_id, tenant_id);

	-- custom_achievements
	CREATE TABLE custom_achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		child_id INTEGER NOT NULL REFERENCES children(id),
		name TEXT NOT NULL,
		description TEXT,
		icon TEXT NOT NULL DEFAULT '🏅',
		condition_type TEXT NOT NULL,
		condition_activity_id INTEGER,
		condition_category_id INTEGER,
		condition_value INTEGER NOT NULL,
		bonus_points INTEGER NOT NULL DEFAULT 100,
		unlocked_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_custom_achievements_tenant_child ON custom_achievements(tenant_id, child_id);

	-- custom_titles
	CREATE TABLE custom_titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		child_id INTEGER NOT NULL REFERENCES children(id),
		name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '📛',
		condition_type TEXT NOT NULL,
		condition_value INTEGER NOT NULL,
		condition_activity_id INTEGER,
		unlocked_at TEXT,
		equipped INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_custom_titles_tenant_child ON custom_titles(tenant_id, child_id);

	-- cloud_exports
	CREATE TABLE cloud_exports (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		export_type TEXT NOT NULL,
		pin_code TEXT NOT NULL UNIQUE,
		s3_key TEXT NOT NULL,
		file_size_bytes INTEGER NOT NULL,
		label TEXT,
		description TEXT,
		expires_at TEXT NOT NULL,
		download_count INTEGER NOT NULL DEFAULT 0,
		max_downloads INTEGER NOT NULL DEFAULT 10,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_cloud_exports_tenant ON cloud_exports(tenant_id);
	CREATE INDEX idx_cloud_exports_pin ON cloud_exports(pin_code);
`;

// ============================================================
// All table names for reset operations (order matters for FK)
// ============================================================

const ALL_TABLES = [
	'cloud_exports',
	'custom_titles',
	'custom_achievements',
	'certificates',
	'report_daily_summaries',
	'notification_logs',
	'push_subscriptions',
	'sibling_cheers',
	'sibling_challenge_progress',
	'sibling_challenges',
	'stamp_entries',
	'stamp_cards',
	'stamp_masters',
	'activity_mastery',
	'checklist_overrides',
	'checklist_logs',
	'checklist_template_items',
	'checklist_templates',
	'child_activity_preferences',
	'child_custom_voices',
	'level_titles',
	'parent_messages',
	'child_titles',
	'daily_missions',
	'special_rewards',
	'child_achievements',
	'achievements',
	'login_bonuses',
	'character_images',
	'rest_days',
	'evaluations',
	'status_history',
	'statuses',
	'market_benchmarks',
	'point_ledger',
	'activity_logs',
	'activities',
	'titles',
	'children',
	'settings',
	// categories is seed data, not cleared by resetDb
] as const;

// ============================================================
// Helper functions
// ============================================================

/**
 * Create an in-memory test database with the full schema.
 * Returns { sqlite, db } for use in tests.
 */
export function createTestDb(): TestDatabase {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	const db = drizzle(sqlite, { schema });
	return { sqlite, db };
}

/**
 * Delete all data from all tables (except categories seed data).
 * Resets autoincrement counters. Safe to call between tests.
 */
export function resetDb(sqlite: TestSqlite): void {
	for (const table of ALL_TABLES) {
		// Use IF EXISTS to gracefully handle tables not present
		sqlite.exec(`DELETE FROM ${table}`);
	}
	// Reset autoincrement counters
	const tableNames = ALL_TABLES.join("','");
	sqlite.exec(`DELETE FROM sqlite_sequence WHERE name IN ('${tableNames}')`);
}

/**
 * Close the test database connection.
 */
export function closeDb(sqlite: TestSqlite): void {
	sqlite.close();
}
