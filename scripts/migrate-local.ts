// Temporary migration script for local DB schema alignment
import Database from 'better-sqlite3';
import { SQL_CREATE_TABLES } from '../src/lib/server/db/create-tables';

const db = new Database('./data/ganbari-quest.db');
db.pragma('foreign_keys = OFF');

console.log('Running CREATE TABLE IF NOT EXISTS...');
db.exec(SQL_CREATE_TABLES);

// ============================================================
// In-place column additions (ADR-0031 NULL 混在防止対応)
// CREATE TABLE IF NOT EXISTS は既存テーブルを変更しないため、
// 既存 DB に新カラムを追加する場合はここで個別に ALTER TABLE する。
// ============================================================

interface ColumnInfo {
	name: string;
}

function tableHasColumn(table: string, column: string): boolean {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
	return cols.some((c) => c.name === column);
}

// #1593 (ADR-0023 I6): push_subscriptions.subscriber_role を追加
if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'")
		.get() &&
	!tableHasColumn('push_subscriptions', 'subscriber_role')
) {
	console.log('Adding push_subscriptions.subscriber_role column (#1593)…');
	db.exec(`
		ALTER TABLE push_subscriptions ADD COLUMN subscriber_role TEXT NOT NULL DEFAULT 'parent';
		UPDATE push_subscriptions SET subscriber_role = 'parent' WHERE subscriber_role IS NULL OR subscriber_role = '';
	`);
	console.log('  → done');
}

// #1755 (#1709-A): activities.priority カラム追加 + checklist_templates.kind 列削除
//   - 'must' = 今日のおやくそく / 'optional' = ふつうの活動（既定）
//   - kind 列削除は破壊的変更（ADR-0010 Pre-PMF 利用者ゼロ前提）
//   - 既存 kind='routine' レコードは drop（持ち物純化、旧 routine は priority='must' に役割移管）
if (
	db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activities'").get() &&
	!tableHasColumn('activities', 'priority')
) {
	console.log('Adding activities.priority column (#1755 / #1709-A)…');
	db.exec(`
		ALTER TABLE activities ADD COLUMN priority TEXT NOT NULL DEFAULT 'optional';
		UPDATE activities SET priority = 'optional' WHERE priority IS NULL OR priority = '';
	`);
	console.log('  → done (existing rows backfilled to optional)');
}

if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='checklist_templates'")
		.get() &&
	tableHasColumn('checklist_templates', 'kind')
) {
	console.log('Dropping checklist_templates.kind column (#1755 / #1709-A)…');
	// 旧 kind='routine' のテンプレートを先に削除（持ち物純化）
	const droppedRoutines = db
		.prepare("DELETE FROM checklist_templates WHERE kind = 'routine'")
		.run();
	console.log(`  → deleted ${droppedRoutines.changes} legacy 'routine' templates`);
	// SQLite 3.35+ は ALTER TABLE DROP COLUMN を直接サポート
	db.exec('ALTER TABLE checklist_templates DROP COLUMN kind;');
	console.log('  → kind column dropped');
}

// #2267 (EPIC #2266): parent_messages に bonus_points / reward_category カラム追加
//   - bonus_points: 応援機能 (cheer) で付与したボーナスポイント (reward_notice タイプのみで使用)
//   - reward_category: 応援機能のカテゴリ (うんどう/べんきょう/せいかつ/こうりゅう/そうぞう/とくべつ)
//   - 既存 stamp / text レコードは NULL のまま (cheer P 付与なしを意味する)
if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parent_messages'")
		.get() &&
	!tableHasColumn('parent_messages', 'bonus_points')
) {
	console.log('Adding parent_messages.bonus_points column (#2267)…');
	db.exec('ALTER TABLE parent_messages ADD COLUMN bonus_points INTEGER;');
	console.log('  → done (existing rows remain NULL = no cheer P)');
}
if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parent_messages'")
		.get() &&
	!tableHasColumn('parent_messages', 'reward_category')
) {
	console.log('Adding parent_messages.reward_category column (#2267)…');
	db.exec('ALTER TABLE parent_messages ADD COLUMN reward_category TEXT;');
	console.log('  → done (existing rows remain NULL = no category)');
}

// #2362 PR-3 (Phase 7b-2a): activity 系 FK 切替 (旧 activities → child_activities)
//   - activity_logs / daily_missions / activity_mastery / child_activity_preferences の 4 件
//   - 旧 activities table は drop しない (#2458 別 PR)、並存維持
//   - SQLite 制約により FK 単独 ALTER は不可。shadow table 再作成 pattern を使う
//   - 冪等性: PRAGMA foreign_key_list で FK target を確認し、'activities' なら切替実行
//   - 設計 SSOT: docs/design/08-データベース設計書.md / docs/design/data-model-resource-scope.md §4.1
interface ForeignKeyInfo {
	id: number;
	seq: number;
	table: string;
	from: string;
	to: string;
	on_update: string;
	on_delete: string;
	match: string;
}

function tableHasFkToActivities(table: string): boolean {
	if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`).get()) {
		return false;
	}
	const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyInfo[];
	return fks.some((fk) => fk.from === 'activity_id' && fk.table === 'activities');
}

if (
	tableHasFkToActivities('activity_logs') ||
	tableHasFkToActivities('daily_missions') ||
	tableHasFkToActivities('activity_mastery') ||
	tableHasFkToActivities('child_activity_preferences')
) {
	console.log(
		'Switching activity_id FK target: activities → child_activities (#2362 PR-3 Phase 7b-2a)…',
	);
	db.exec('PRAGMA foreign_keys = OFF');

	// 1. activity_logs
	if (tableHasFkToActivities('activity_logs')) {
		console.log('  → activity_logs');
		db.exec(`
			CREATE TABLE activity_logs_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				activity_id INTEGER NOT NULL REFERENCES child_activities(id),
				points INTEGER NOT NULL,
				streak_days INTEGER NOT NULL DEFAULT 1,
				streak_bonus INTEGER NOT NULL DEFAULT 0,
				recorded_date TEXT NOT NULL,
				recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				cancelled INTEGER NOT NULL DEFAULT 0
			);
			INSERT INTO activity_logs_new (id, child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at, cancelled)
				SELECT id, child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at, cancelled FROM activity_logs;
			DROP TABLE activity_logs;
			ALTER TABLE activity_logs_new RENAME TO activity_logs;
			CREATE INDEX idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date);
			CREATE INDEX idx_activity_logs_child_date ON activity_logs(child_id, recorded_date);
			CREATE INDEX idx_activity_logs_activity ON activity_logs(activity_id);
			CREATE INDEX idx_activity_logs_streak ON activity_logs(child_id, activity_id, recorded_date);
		`);
	}

	// 2. daily_missions
	if (tableHasFkToActivities('daily_missions')) {
		console.log('  → daily_missions');
		db.exec(`
			CREATE TABLE daily_missions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				mission_date TEXT NOT NULL,
				activity_id INTEGER NOT NULL REFERENCES child_activities(id),
				completed INTEGER NOT NULL DEFAULT 0,
				completed_at TEXT
			);
			INSERT INTO daily_missions_new (id, child_id, mission_date, activity_id, completed, completed_at)
				SELECT id, child_id, mission_date, activity_id, completed, completed_at FROM daily_missions;
			DROP TABLE daily_missions;
			ALTER TABLE daily_missions_new RENAME TO daily_missions;
			CREATE UNIQUE INDEX idx_daily_missions_unique ON daily_missions(child_id, mission_date, activity_id);
			CREATE INDEX idx_daily_missions_child_date ON daily_missions(child_id, mission_date);
		`);
	}

	// 3. activity_mastery
	if (tableHasFkToActivities('activity_mastery')) {
		console.log('  → activity_mastery');
		db.exec(`
			CREATE TABLE activity_mastery_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				activity_id INTEGER NOT NULL REFERENCES child_activities(id),
				total_count INTEGER NOT NULL DEFAULT 0,
				level INTEGER NOT NULL DEFAULT 1,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			INSERT INTO activity_mastery_new (id, child_id, activity_id, total_count, level, updated_at)
				SELECT id, child_id, activity_id, total_count, level, updated_at FROM activity_mastery;
			DROP TABLE activity_mastery;
			ALTER TABLE activity_mastery_new RENAME TO activity_mastery;
			CREATE UNIQUE INDEX idx_activity_mastery_child_activity ON activity_mastery(child_id, activity_id);
		`);
	}

	// 4. child_activity_preferences (ON DELETE CASCADE 維持)
	if (tableHasFkToActivities('child_activity_preferences')) {
		console.log('  → child_activity_preferences');
		db.exec(`
			CREATE TABLE child_activity_preferences_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
				activity_id INTEGER NOT NULL REFERENCES child_activities(id) ON DELETE CASCADE,
				is_pinned INTEGER NOT NULL DEFAULT 0,
				pin_order INTEGER,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			INSERT INTO child_activity_preferences_new (id, child_id, activity_id, is_pinned, pin_order, created_at, updated_at)
				SELECT id, child_id, activity_id, is_pinned, pin_order, created_at, updated_at FROM child_activity_preferences;
			DROP TABLE child_activity_preferences;
			ALTER TABLE child_activity_preferences_new RENAME TO child_activity_preferences;
			CREATE UNIQUE INDEX idx_child_activity_prefs_unique ON child_activity_preferences(child_id, activity_id);
			CREATE INDEX idx_child_activity_prefs_child ON child_activity_preferences(child_id);
			CREATE INDEX idx_child_activity_prefs_pinned ON child_activity_preferences(child_id, is_pinned);
		`);
	}

	db.exec('PRAGMA foreign_keys = ON');
	console.log('  → activity FK switchover complete');
}

// #2362 PR-5 (Phase 1): checklist_templates family master 化
//   - 旧: checklist_templates.child_id NOT NULL (per-child instance)
//   - 新: checklist_templates に tenant_id 列追加 + child_id 列削除
//         + checklist_template_assignments 新規 (template ↔ child N:M binding)
//   - 既存 per-child template は配信先 1 件の family master + assignment 1 行に変換
//   - 既存 checklist_logs / checklist_overrides の child_id は維持 (per-child progress / override の事実履歴)
//   - 冪等性: PRAGMA table_info で child_id 列の有無を確認し、既に新形式なら skip
//   - SQLite 制約: DROP COLUMN は 3.35+、shadow table 再作成 pattern を併用 (FK 維持)
//   - SSOT: docs/design/data-model-resource-scope.md §4.2
if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='checklist_templates'")
		.get() &&
	tableHasColumn('checklist_templates', 'child_id')
) {
	console.log(
		'Switching checklist_templates: per-child instance → family master (#2362 PR-5 Phase 1)…',
	);
	db.exec('PRAGMA foreign_keys = OFF');

	const hasTenantId = tableHasColumn('checklist_templates', 'tenant_id');

	// 1. checklist_templates: tenant_id 追加 (なければ) + child_id 削除 + shadow table 再作成
	db.exec(`
		CREATE TABLE checklist_templates_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tenant_id TEXT NOT NULL DEFAULT 'default',
			name TEXT NOT NULL,
			icon TEXT NOT NULL DEFAULT '📋',
			points_per_item INTEGER NOT NULL DEFAULT 2,
			completion_bonus INTEGER NOT NULL DEFAULT 5,
			time_slot TEXT NOT NULL DEFAULT 'anytime',
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			is_archived INTEGER NOT NULL DEFAULT 0,
			archived_reason TEXT,
			source_preset_id TEXT
		);
	`);

	// 2. 既存 row を新 schema に移行。tenant_id は (a) 既に列があればその値、(b) なければ 'default'。
	if (hasTenantId) {
		db.exec(`
			INSERT INTO checklist_templates_new
				(id, tenant_id, name, icon, points_per_item, completion_bonus, time_slot, is_active,
				 created_at, updated_at, is_archived, archived_reason, source_preset_id)
				SELECT id, COALESCE(tenant_id, 'default'), name, icon, points_per_item, completion_bonus, time_slot, is_active,
				 created_at, updated_at, is_archived, COALESCE(archived_reason, NULL), COALESCE(source_preset_id, NULL)
				 FROM checklist_templates;
		`);
	} else {
		db.exec(`
			INSERT INTO checklist_templates_new
				(id, tenant_id, name, icon, points_per_item, completion_bonus, time_slot, is_active,
				 created_at, updated_at, is_archived, archived_reason, source_preset_id)
				SELECT id, 'default', name, icon, points_per_item, completion_bonus, time_slot, is_active,
				 created_at, updated_at, is_archived, COALESCE(archived_reason, NULL), COALESCE(source_preset_id, NULL)
				 FROM checklist_templates;
		`);
	}

	// 3. 新規 assignments table (旧 per-child template の child_id を 1 row ずつ移行)
	db.exec(`
		CREATE TABLE IF NOT EXISTS checklist_template_assignments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
			child_id INTEGER NOT NULL REFERENCES children(id),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_template_assignments_unique
			ON checklist_template_assignments(template_id, child_id);
		CREATE INDEX IF NOT EXISTS idx_checklist_template_assignments_child
			ON checklist_template_assignments(child_id);
		INSERT INTO checklist_template_assignments (template_id, child_id, created_at)
			SELECT id, child_id, created_at FROM checklist_templates;
	`);

	const assignmentCount = (
		db.prepare('SELECT COUNT(*) AS c FROM checklist_template_assignments').get() as { c: number }
	).c;
	console.log(`  → migrated ${assignmentCount} per-child rows to template_assignments`);

	// 4. 旧 table を drop して new を rename
	db.exec(`
		DROP TABLE checklist_templates;
		ALTER TABLE checklist_templates_new RENAME TO checklist_templates;
		CREATE INDEX IF NOT EXISTS idx_checklist_templates_tenant_archived
			ON checklist_templates(tenant_id, is_archived);
	`);

	db.exec('PRAGMA foreign_keys = ON');
	console.log('  → checklist family master flip complete');
}

const tables = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
	.all() as { name: string }[];
console.log('Tables:', tables.map((t) => t.name).join(', '));

db.close();
console.log('Migration complete.');
