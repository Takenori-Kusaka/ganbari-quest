-- tests/fixtures/legacy-schema/2026-05.sql
--
-- #2520 AC1 — 直近本番 schema snapshot (EF Core model snapshot pattern、research §2 Class 2)
--
-- これは NUC production が #2508 (startup failure 2026-05-27) を起こした時点の
-- 「アップグレード前」schema を再現する DDL である。新 schema (create-tables.ts /
-- lazy-startup-migrations.ts) を載せた起動シーケンスでこの DB が no-error で立ち上がることを
-- `tests/integration/db/legacy-schema-upgrade.test.ts` が検証する。
--
-- 特徴 (= #2508 で起動 block の原因となった旧状態):
--   - checklist_templates: child_id NOT NULL + kind 列あり + tenant_id 列なし
--     (PR #2480 で family master 化される前の per-child instance schema)
--   - activity_logs / daily_missions / activity_mastery / child_activity_preferences:
--     FK target = activities (旧 per-table)。switchover (child_activities 化) 前。
--
-- ============================================================
-- 世代管理ルール (#2520 AC3、Pre-PMF)
-- ============================================================
--   schema 破壊変更 (DROP COLUMN / FK target 変更 / NOT NULL 変更 / cross-table flip) を
--   含む PR ごとに、その時点の「変更前 production schema」を本ディレクトリへ
--   `<YYYY-MM>.sql` で 1 世代追加する。世代は 2-3 件保持で十分 (古いものは削除可)。
--   legacy-schema-upgrade.test.ts は本ディレクトリの全 *.sql を対象に起動成功を検証するため、
--   新世代を追加すれば自動的に upgrade path 回帰の対象になる。
--
-- 注意: 本 fixture は「起動 (DDL upgrade) が通る」ことの検証用であり、列定義は
--   起動シーケンス (lazy-startup-migrations → SQL_CREATE_TABLES → validateAndMigrate) が
--   触る範囲のみを再現する (全カラムの完全再現ではない)。

PRAGMA foreign_keys = OFF;

CREATE TABLE children (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	nickname TEXT NOT NULL,
	age INTEGER NOT NULL DEFAULT 5,
	birth_date TEXT,
	theme TEXT NOT NULL DEFAULT 'pink',
	ui_mode TEXT NOT NULL DEFAULT 'preschool',
	avatar_url TEXT,
	display_config TEXT,
	user_id TEXT,
	birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
	last_birthday_bonus_year INTEGER,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_archived INTEGER NOT NULL DEFAULT 0,
	archived_reason TEXT
);

-- SQL_CREATE_TABLES の categories と同形 (5 列、INSERT OR IGNORE と整合)
CREATE TABLE categories (
	id INTEGER PRIMARY KEY,
	code TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	icon TEXT,
	color TEXT
);

CREATE TABLE activities (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	category_id INTEGER REFERENCES categories(id),
	icon TEXT NOT NULL DEFAULT '⭐',
	base_points INTEGER NOT NULL DEFAULT 5,
	is_visible INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	source TEXT NOT NULL DEFAULT 'seed',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_archived INTEGER NOT NULL DEFAULT 0,
	archived_reason TEXT,
	priority TEXT NOT NULL DEFAULT 'optional'
);

CREATE TABLE child_activities (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	child_id INTEGER NOT NULL REFERENCES children(id),
	name TEXT NOT NULL,
	category_id INTEGER REFERENCES categories(id),
	icon TEXT NOT NULL DEFAULT '⭐',
	base_points INTEGER NOT NULL DEFAULT 5,
	is_visible INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	source TEXT NOT NULL DEFAULT 'seed',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_archived INTEGER NOT NULL DEFAULT 0,
	archived_reason TEXT,
	priority TEXT NOT NULL DEFAULT 'optional'
);

-- 旧 schema (#2508 発生時点と一致): child_id NOT NULL + kind 列あり + tenant_id なし
CREATE TABLE checklist_templates (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	child_id INTEGER NOT NULL REFERENCES children(id),
	name TEXT NOT NULL,
	icon TEXT NOT NULL DEFAULT '📋',
	points_per_item INTEGER NOT NULL DEFAULT 2,
	completion_bonus INTEGER NOT NULL DEFAULT 5,
	time_slot TEXT,
	is_active INTEGER NOT NULL DEFAULT 1,
	is_archived INTEGER,
	archived_reason TEXT,
	source_preset_id TEXT,
	kind TEXT NOT NULL DEFAULT 'routine',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE daily_missions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	child_id INTEGER NOT NULL REFERENCES children(id),
	mission_date TEXT NOT NULL,
	activity_id INTEGER NOT NULL REFERENCES activities(id),
	completed INTEGER NOT NULL DEFAULT 0,
	completed_at TEXT
);

CREATE TABLE activity_mastery (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	child_id INTEGER NOT NULL REFERENCES children(id),
	activity_id INTEGER NOT NULL REFERENCES activities(id),
	total_count INTEGER NOT NULL DEFAULT 0,
	level INTEGER NOT NULL DEFAULT 1,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE child_activity_preferences (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
	activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
	is_pinned INTEGER NOT NULL DEFAULT 0,
	pin_order INTEGER,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

PRAGMA foreign_keys = ON;
