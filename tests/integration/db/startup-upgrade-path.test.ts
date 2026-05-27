// tests/integration/db/startup-upgrade-path.test.ts
//
// startup 経路 (`client.ts` と同 sequence) を full reproduction し、
// legacy production schema → 新 schema へ no-error で upgrade されることを
// 検証する。Issue #2508 (NUC startup failure 2026-05-27) の回帰テスト。
//
// reproduction:
//   1. legacy production schema (child_id NOT NULL / kind 列あり / FK→activities) を seed
//   2. applyLazyStartupMigrations(db)     ← 本 hotfix で追加した step
//   3. db.exec(SQL_CREATE_TABLES)         ← `no such column: tenant_id` で fail していた step
//   4. validateAndMigrate(db)             ← schema-validator による drizzle 差分追加
//   → 3 全 step が no-error で完了し、最終 schema が正しい状態であることを assert
//
// 本 hotfix 前: step 3 が `SqliteError: no such column: tenant_id` で fail → app crash

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SQL_CREATE_TABLES } from '../../../src/lib/server/db/create-tables';
import { applyLazyStartupMigrations } from '../../../src/lib/server/db/migration/lazy-startup-migrations';
import { validateAndMigrate } from '../../../src/lib/server/db/schema-validator';

interface ColumnInfo {
	name: string;
	type: string;
	notnull: number;
}
interface FkInfo {
	table: string;
	from: string;
	to: string;
}

function getColumns(db: Database.Database, table: string): ColumnInfo[] {
	return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}
function tableExists(db: Database.Database, name: string): boolean {
	return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}
function fkTargets(db: Database.Database, table: string): FkInfo[] {
	return db.prepare(`PRAGMA foreign_key_list(${table})`).all() as FkInfo[];
}

/**
 * NUC production (#2508 発生時点 2026-05-27) の旧 schema を再現する seed。
 * children / categories / activities / child_activities は production NUC で
 * 既に新 schema を満たすため `CREATE TABLE IF NOT EXISTS` 後の `CREATE INDEX`
 * (is_archived 等) が成功する状態を再現する。
 */
function seedLegacyProductionDb(db: Database.Database): void {
	db.pragma('foreign_keys = OFF');
	db.exec(`
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
	`);
	db.pragma('foreign_keys = ON');
}

describe('startup upgrade path (legacy NUC production DB → new schema)', () => {
	it('client.ts と同 sequence (lazy → SQL_CREATE_TABLES → validateAndMigrate) で no-error 完了する', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');

		try {
			seedLegacyProductionDb(db);

			// === step 1: shadow-table recreation 系 (本 hotfix で追加された step) ===
			expect(() => applyLazyStartupMigrations(db)).not.toThrow();

			// === step 2: SQL_CREATE_TABLES (本 hotfix 前はここで `no such column: tenant_id` fail) ===
			expect(() => db.exec(SQL_CREATE_TABLES)).not.toThrow();

			// === step 3: drizzle validateAndMigrate (個別 ALTER ADD COLUMN) ===
			// validateAndMigrate は schema 差分を warn として残すが throw はしない。
			// extraColumns 警告は legacy schema との差分由来なので無視できる。
			const result = validateAndMigrate(db);
			expect(result.errors, `unexpected errors: ${JSON.stringify(result.errors)}`).toEqual([]);

			// === 最終 schema 検証 ===
			// checklist_templates: kind 列なし / tenant_id NOT NULL / child_id 列なし
			const ctCols = getColumns(db, 'checklist_templates');
			expect(ctCols.some((c) => c.name === 'kind')).toBe(false);
			expect(ctCols.some((c) => c.name === 'child_id')).toBe(false);
			const tenantIdCol = ctCols.find((c) => c.name === 'tenant_id');
			expect(tenantIdCol?.notnull).toBe(1);

			// checklist_template_assignments table 作成
			expect(tableExists(db, 'checklist_template_assignments')).toBe(true);

			// activity_* FK target = child_activities
			for (const table of [
				'activity_logs',
				'daily_missions',
				'activity_mastery',
				'child_activity_preferences',
			]) {
				const fks = fkTargets(db, table);
				const activityFk = fks.find((fk) => fk.from === 'activity_id');
				expect(activityFk?.table, `${table}.activity_id FK target`).toBe('child_activities');
			}
		} finally {
			db.close();
		}
	});

	it('legacy schema + 既存データ (per-child template 2 件 + activity_logs 3 件) を保全する', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');

		try {
			seedLegacyProductionDb(db);
			db.prepare("INSERT INTO children (nickname, age) VALUES ('A', 5)").run();
			db.prepare("INSERT INTO children (nickname, age) VALUES ('B', 7)").run();
			db.prepare("INSERT INTO activities (name) VALUES ('walk')").run();
			db.prepare("INSERT INTO child_activities (child_id, name) VALUES (1, 'walk-A')").run();
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, kind) VALUES (1, 'morning', 'belongings')",
			).run();
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, kind) VALUES (2, 'evening', 'belongings')",
			).run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 1, 10, '2026-05-27')",
			).run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 1, 5, '2026-05-26')",
			).run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (2, 1, 8, '2026-05-26')",
			).run();

			applyLazyStartupMigrations(db);
			db.exec(SQL_CREATE_TABLES);
			validateAndMigrate(db);

			// templates 2 件 (family master) + assignments 2 件 (旧 per-child child_id)
			const tplCnt = db.prepare('SELECT COUNT(*) AS c FROM checklist_templates').get() as {
				c: number;
			};
			expect(tplCnt.c).toBe(2);
			const assignCnt = db
				.prepare('SELECT COUNT(*) AS c FROM checklist_template_assignments')
				.get() as { c: number };
			expect(assignCnt.c).toBe(2);

			// activity_logs 3 件保全
			const logCnt = db.prepare('SELECT COUNT(*) AS c FROM activity_logs').get() as { c: number };
			expect(logCnt.c).toBe(3);
		} finally {
			db.close();
		}
	});

	it('既に新 schema 状態の DB に対して再起動シーケンスを流しても no-error (冪等)', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');

		try {
			// 1 回目
			seedLegacyProductionDb(db);
			applyLazyStartupMigrations(db);
			db.exec(SQL_CREATE_TABLES);
			validateAndMigrate(db);

			// 2 回目 (再起動相当): 全 step が no-error で skip
			expect(() => applyLazyStartupMigrations(db)).not.toThrow();
			expect(() => db.exec(SQL_CREATE_TABLES)).not.toThrow();
			const result = validateAndMigrate(db);
			expect(result.errors).toEqual([]);
		} finally {
			db.close();
		}
	});
});
