// src/lib/server/db/create-tables.ts
// Shared CREATE TABLE SQL — used by both Lambda cold-start init and tests.
// This is the single source of truth for table structure.

export const SQL_CREATE_TABLES = `
	CREATE TABLE IF NOT EXISTS categories (
		id INTEGER PRIMARY KEY,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		icon TEXT,
		color TEXT
	);

	INSERT OR IGNORE INTO categories VALUES (1, 'undou', 'うんどう', '🏃', '#FF6B6B');
	INSERT OR IGNORE INTO categories VALUES (2, 'benkyou', 'べんきょう', '📚', '#4ECDC4');
	INSERT OR IGNORE INTO categories VALUES (3, 'seikatsu', 'せいかつ', '🏠', '#FFE66D');
	INSERT OR IGNORE INTO categories VALUES (4, 'kouryuu', 'こうりゅう', '🤝', '#A8E6CF');
	INSERT OR IGNORE INTO categories VALUES (5, 'souzou', 'そうぞう', '🎨', '#DDA0DD');

	CREATE TABLE IF NOT EXISTS titles (
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

	CREATE TABLE IF NOT EXISTS children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL,
		age INTEGER NOT NULL,
		birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		active_title_id INTEGER,
		active_avatar_bg INTEGER,
		active_avatar_frame INTEGER,
		active_avatar_effect INTEGER,
		active_avatar_sound INTEGER,
		active_avatar_celebration INTEGER,
		display_config TEXT,
		user_id TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS activities (
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

	CREATE TABLE IF NOT EXISTS activity_logs (
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
	CREATE INDEX IF NOT EXISTS idx_activity_logs_daily
		ON activity_logs(child_id, activity_id, recorded_date);
	CREATE INDEX IF NOT EXISTS idx_activity_logs_child_date
		ON activity_logs(child_id, recorded_date);
	CREATE INDEX IF NOT EXISTS idx_activity_logs_activity
		ON activity_logs(activity_id);
	CREATE INDEX IF NOT EXISTS idx_activity_logs_streak
		ON activity_logs(child_id, activity_id, recorded_date);

	CREATE TABLE IF NOT EXISTS point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL,
		type TEXT NOT NULL,
		description TEXT,
		reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_point_ledger_child ON point_ledger(child_id, created_at);

	CREATE TABLE IF NOT EXISTS statuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id),
		value REAL NOT NULL DEFAULT 0.0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_child_category ON statuses(child_id, category_id);

	CREATE TABLE IF NOT EXISTS status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id),
		value REAL NOT NULL,
		change_amount REAL NOT NULL,
		change_type TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_status_history_child_cat
		ON status_history(child_id, category_id, recorded_at);

	CREATE TABLE IF NOT EXISTS evaluations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		week_start TEXT NOT NULL,
		week_end TEXT NOT NULL,
		scores_json TEXT NOT NULL,
		bonus_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL,
		category_id INTEGER NOT NULL REFERENCES categories(id),
		mean REAL NOT NULL,
		std_dev REAL NOT NULL,
		source TEXT,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmarks_age_category
		ON market_benchmarks(age, category_id);

	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS character_images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		type TEXT NOT NULL,
		file_path TEXT NOT NULL,
		prompt_hash TEXT,
		generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS login_bonuses (
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
	CREATE UNIQUE INDEX IF NOT EXISTS idx_login_bonuses_child_date
		ON login_bonuses(child_id, login_date);

	CREATE TABLE IF NOT EXISTS achievements (
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

	CREATE TABLE IF NOT EXISTS child_achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		achievement_id INTEGER NOT NULL REFERENCES achievements(id),
		milestone_value INTEGER,
		unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_child_achievements_unique
		ON child_achievements(child_id, achievement_id, milestone_value);

	CREATE TABLE IF NOT EXISTS special_rewards (
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
	CREATE INDEX IF NOT EXISTS idx_special_rewards_child
		ON special_rewards(child_id, granted_at);

	CREATE TABLE IF NOT EXISTS checklist_templates (
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

	CREATE TABLE IF NOT EXISTS checklist_template_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
		name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '🏫',
		frequency TEXT NOT NULL DEFAULT 'daily',
		direction TEXT NOT NULL DEFAULT 'bring',
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_checklist_items_template
		ON checklist_template_items(template_id);

	CREATE TABLE IF NOT EXISTS checklist_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
		checked_date TEXT NOT NULL,
		items_json TEXT NOT NULL DEFAULT '[]',
		completed_all INTEGER NOT NULL DEFAULT 0,
		points_awarded INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_logs_unique_daily
		ON checklist_logs(child_id, template_id, checked_date);

	CREATE TABLE IF NOT EXISTS checklist_overrides (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		target_date TEXT NOT NULL,
		action TEXT NOT NULL,
		item_name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '📦',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_checklist_overrides_child_date
		ON checklist_overrides(child_id, target_date);

	CREATE TABLE IF NOT EXISTS birthday_reviews (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		review_year INTEGER NOT NULL,
		age_at_review INTEGER NOT NULL,
		health_checks TEXT NOT NULL DEFAULT '{}',
		aspiration_text TEXT,
		aspiration_categories TEXT NOT NULL DEFAULT '{}',
		base_points INTEGER NOT NULL DEFAULT 0,
		health_points INTEGER NOT NULL DEFAULT 0,
		aspiration_points INTEGER NOT NULL DEFAULT 0,
		total_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_birthday_reviews_unique
		ON birthday_reviews(child_id, review_year);

	CREATE TABLE IF NOT EXISTS daily_missions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		mission_date TEXT NOT NULL,
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		completed INTEGER NOT NULL DEFAULT 0,
		completed_at TEXT
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_missions_unique
		ON daily_missions(child_id, mission_date, activity_id);
	CREATE INDEX IF NOT EXISTS idx_daily_missions_child_date
		ON daily_missions(child_id, mission_date);

	CREATE TABLE IF NOT EXISTS avatar_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		description TEXT,
		category TEXT NOT NULL,
		icon TEXT NOT NULL,
		css_value TEXT NOT NULL,
		price INTEGER NOT NULL DEFAULT 0,
		unlock_type TEXT NOT NULL DEFAULT 'purchase',
		unlock_condition TEXT,
		rarity TEXT NOT NULL DEFAULT 'common',
		sort_order INTEGER NOT NULL DEFAULT 0,
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS child_avatar_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		avatar_item_id INTEGER NOT NULL REFERENCES avatar_items(id),
		acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_child_avatar_items_unique
		ON child_avatar_items(child_id, avatar_item_id);

	CREATE TABLE IF NOT EXISTS child_titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		title_id INTEGER NOT NULL REFERENCES titles(id),
		unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_child_titles_unique
		ON child_titles(child_id, title_id);

	CREATE TABLE IF NOT EXISTS career_fields (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		description TEXT,
		icon TEXT,
		related_categories TEXT NOT NULL DEFAULT '[]',
		recommended_activities TEXT NOT NULL DEFAULT '[]',
		min_age INTEGER NOT NULL DEFAULT 6,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS career_plans (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		career_field_id INTEGER REFERENCES career_fields(id),
		dream_text TEXT,
		mandala_chart TEXT NOT NULL DEFAULT '{}',
		timeline_3y TEXT,
		timeline_5y TEXT,
		timeline_10y TEXT,
		target_statuses TEXT NOT NULL DEFAULT '{}',
		version INTEGER NOT NULL DEFAULT 1,
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_career_plans_child
		ON career_plans(child_id, is_active);

	CREATE TABLE IF NOT EXISTS career_plan_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		career_plan_id INTEGER NOT NULL REFERENCES career_plans(id),
		action TEXT NOT NULL,
		points_earned INTEGER NOT NULL DEFAULT 0,
		snapshot TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_career_plan_history_plan
		ON career_plan_history(career_plan_id);

	CREATE TABLE IF NOT EXISTS level_titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		level INTEGER NOT NULL,
		custom_title TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_level_titles_tenant_level
		ON level_titles(tenant_id, level);
`;
