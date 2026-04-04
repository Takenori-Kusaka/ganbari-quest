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

	CREATE TABLE IF NOT EXISTS children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL,
		age INTEGER NOT NULL,
		birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		display_config TEXT,
		user_id TEXT,
		birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
		last_birthday_bonus_year INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER
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
		total_xp INTEGER NOT NULL DEFAULT 0,
		level INTEGER NOT NULL DEFAULT 1,
		peak_xp INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER
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

	CREATE TABLE IF NOT EXISTS rest_days (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		date TEXT NOT NULL,
		reason TEXT NOT NULL DEFAULT 'rest',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_rest_days_child_date
		ON rest_days(child_id, date);

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

	CREATE TABLE IF NOT EXISTS child_custom_voices (
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
	CREATE INDEX IF NOT EXISTS idx_child_custom_voices_child
		ON child_custom_voices(child_id, scene);

	CREATE TABLE IF NOT EXISTS parent_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		message_type TEXT NOT NULL,
		stamp_code TEXT,
		body TEXT,
		icon TEXT NOT NULL DEFAULT '💌',
		sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		shown_at TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_parent_messages_child
		ON parent_messages(child_id, sent_at);
	CREATE INDEX IF NOT EXISTS idx_parent_messages_unshown
		ON parent_messages(child_id, shown_at);

	CREATE TABLE IF NOT EXISTS activity_mastery (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		total_count INTEGER NOT NULL DEFAULT 0,
		level INTEGER NOT NULL DEFAULT 1,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_mastery_child_activity
		ON activity_mastery(child_id, activity_id);

	CREATE TABLE IF NOT EXISTS child_activity_preferences (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
		is_pinned INTEGER NOT NULL DEFAULT 0,
		pin_order INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_child_activity_prefs_unique
		ON child_activity_preferences(child_id, activity_id);
	CREATE INDEX IF NOT EXISTS idx_child_activity_prefs_child
		ON child_activity_preferences(child_id);
	CREATE INDEX IF NOT EXISTS idx_child_activity_prefs_pinned
		ON child_activity_preferences(child_id, is_pinned);

	CREATE TABLE IF NOT EXISTS stamp_masters (
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

	CREATE TABLE IF NOT EXISTS stamp_cards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		week_start TEXT NOT NULL,
		week_end TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'collecting',
		redeemed_points INTEGER,
		redeemed_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_cards_child_week
		ON stamp_cards(child_id, week_start);
	CREATE INDEX IF NOT EXISTS idx_stamp_cards_child
		ON stamp_cards(child_id);
	CREATE TABLE IF NOT EXISTS stamp_entries (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		card_id INTEGER NOT NULL REFERENCES stamp_cards(id) ON DELETE CASCADE,
		stamp_master_id INTEGER REFERENCES stamp_masters(id),
		omikuji_rank TEXT,
		slot INTEGER NOT NULL,
		login_date TEXT NOT NULL,
		earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_entries_card_slot
		ON stamp_entries(card_id, slot);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_entries_card_date
		ON stamp_entries(card_id, login_date);

	CREATE TABLE IF NOT EXISTS season_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		description TEXT,
		event_type TEXT NOT NULL DEFAULT 'seasonal',
		start_date TEXT NOT NULL,
		end_date TEXT NOT NULL,
		banner_icon TEXT NOT NULL DEFAULT '🎉',
		banner_color TEXT,
		theme_config TEXT,
		reward_config TEXT,
		mission_config TEXT,
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS child_event_progress (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		event_id INTEGER NOT NULL REFERENCES season_events(id),
		status TEXT NOT NULL DEFAULT 'active',
		progress_json TEXT,
		reward_claimed_at TEXT,
		joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_child_event_unique
		ON child_event_progress(child_id, event_id);
	CREATE INDEX IF NOT EXISTS idx_child_event_child
		ON child_event_progress(child_id);

	CREATE TABLE IF NOT EXISTS sibling_challenges (
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
	CREATE INDEX IF NOT EXISTS idx_sibling_challenges_status
		ON sibling_challenges(status);
	CREATE INDEX IF NOT EXISTS idx_sibling_challenges_dates
		ON sibling_challenges(start_date, end_date);

	CREATE TABLE IF NOT EXISTS sibling_challenge_progress (
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
	CREATE UNIQUE INDEX IF NOT EXISTS idx_sibling_challenge_progress_unique
		ON sibling_challenge_progress(challenge_id, child_id);
	CREATE INDEX IF NOT EXISTS idx_sibling_challenge_progress_child
		ON sibling_challenge_progress(child_id);

	CREATE TABLE IF NOT EXISTS sibling_cheers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		from_child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		to_child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		stamp_code TEXT NOT NULL,
		tenant_id TEXT NOT NULL DEFAULT 'default',
		sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		shown_at TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_sibling_cheers_to_shown
		ON sibling_cheers(to_child_id, shown_at);

	CREATE TABLE IF NOT EXISTS push_subscriptions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		endpoint TEXT NOT NULL UNIQUE,
		keys_p256dh TEXT NOT NULL,
		keys_auth TEXT NOT NULL,
		user_agent TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_push_subs_tenant
		ON push_subscriptions(tenant_id);

	CREATE TABLE IF NOT EXISTS notification_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		notification_type TEXT NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL,
		sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		success INTEGER NOT NULL DEFAULT 1,
		error_message TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_date
		ON notification_logs(tenant_id, sent_at);

	CREATE TABLE IF NOT EXISTS report_daily_summaries (
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
	CREATE INDEX IF NOT EXISTS idx_report_daily_child_date
		ON report_daily_summaries(child_id, date);
	CREATE INDEX IF NOT EXISTS idx_report_daily_tenant_date
		ON report_daily_summaries(tenant_id, date);

	CREATE TABLE IF NOT EXISTS certificates (
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
	CREATE INDEX IF NOT EXISTS idx_certificates_child
		ON certificates(child_id, tenant_id);

	CREATE TABLE IF NOT EXISTS custom_achievements (
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
	CREATE INDEX IF NOT EXISTS idx_custom_achievements_tenant_child
		ON custom_achievements(tenant_id, child_id);

	CREATE TABLE IF NOT EXISTS cloud_exports (
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
	CREATE INDEX IF NOT EXISTS idx_cloud_exports_tenant
		ON cloud_exports(tenant_id);
	CREATE INDEX IF NOT EXISTS idx_cloud_exports_pin
		ON cloud_exports(pin_code);
`;
