// tests/unit/db/lazy-startup-migrations.test.ts
//
// applyLazyStartupMigrations の冪等性 + shadow-table recreation
// 動作検証。NUC startup failure (Issue #2508) の回帰テスト。

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyLazyStartupMigrations } from '$lib/server/db/migration/lazy-startup-migrations';

interface ColumnInfo {
	name: string;
	type: string;
	notnull: number;
	dflt_value: string | null;
}
interface FkInfo {
	table: string;
	from: string;
	to: string;
}

function getColumns(db: Database.Database, table: string): ColumnInfo[] {
	return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}
function hasColumn(db: Database.Database, table: string, column: string): boolean {
	return getColumns(db, table).some((c) => c.name === column);
}
function tableExists(db: Database.Database, name: string): boolean {
	return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}
function fkTargets(db: Database.Database, table: string): FkInfo[] {
	return db.prepare(`PRAGMA foreign_key_list(${table})`).all() as FkInfo[];
}

/**
 * production NUC の旧 schema をそのまま再現した fixture を作成する。
 * - checklist_templates: child_id NOT NULL, tenant_id 列なし, kind 列あり
 * - activity_logs / daily_missions / activity_mastery / child_activity_preferences:
 *   FK target = activities (旧 target)
 * - children / activities / child_activities table も最低限作成
 */
function seedLegacyProductionSchema(db: Database.Database): void {
	db.pragma('foreign_keys = OFF');
	db.exec(`
		CREATE TABLE children (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			nickname TEXT NOT NULL,
			age INTEGER NOT NULL DEFAULT 5
		);
		CREATE TABLE activities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL
		);
		CREATE TABLE child_activities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			name TEXT NOT NULL
		);

		-- 旧 schema (NUC production と一致): child_id NOT NULL + tenant_id なし + kind あり
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

		-- 旧 FK target: activities
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

describe('applyLazyStartupMigrations', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
	});

	afterEach(() => {
		db.close();
	});

	describe('legacy production schema → new schema upgrade', () => {
		beforeEach(() => {
			seedLegacyProductionSchema(db);
		});

		it('checklist_templates.kind 列を drop して routine レコードを削除する (#1755)', () => {
			db.prepare("INSERT INTO children (nickname, age) VALUES ('A', 5)").run();
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, kind) VALUES (1, 'routine-template', 'routine')",
			).run();
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, kind) VALUES (1, 'belongings-template', 'belongings')",
			).run();

			applyLazyStartupMigrations(db);

			expect(hasColumn(db, 'checklist_templates', 'kind')).toBe(false);
			// 'routine' 1 件は削除、'belongings' 1 件は family flip で生き残る
			const remaining = db.prepare('SELECT name FROM checklist_templates ORDER BY id').all() as {
				name: string;
			}[];
			expect(remaining.map((r) => r.name)).toEqual(['belongings-template']);
		});

		it('checklist_templates を child_id (NOT NULL) → tenant_id (NOT NULL) に flip し assignments に migrate する (#2362 PR-5)', () => {
			db.prepare("INSERT INTO children (nickname, age) VALUES ('A', 5)").run();
			db.prepare("INSERT INTO children (nickname, age) VALUES ('B', 7)").run();
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, kind) VALUES (1, 'morning', 'belongings')",
			).run();
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, kind) VALUES (2, 'evening', 'belongings')",
			).run();

			applyLazyStartupMigrations(db);

			// checklist_templates: tenant_id NOT NULL 列が存在、child_id 列なし
			const cols = getColumns(db, 'checklist_templates');
			const tenantIdCol = cols.find((c) => c.name === 'tenant_id');
			expect(tenantIdCol).toBeDefined();
			expect(tenantIdCol?.notnull).toBe(1);
			expect(cols.some((c) => c.name === 'child_id')).toBe(false);

			// assignments table 存在 + 旧 per-child の child_id 値 2 件が assignments に移っている
			expect(tableExists(db, 'checklist_template_assignments')).toBe(true);
			const assignments = db
				.prepare('SELECT template_id, child_id FROM checklist_template_assignments ORDER BY id')
				.all();
			expect(assignments).toEqual([
				{ template_id: 1, child_id: 1 },
				{ template_id: 2, child_id: 2 },
			]);

			// templates 自体は family master として 2 件残る (tenant_id='default')
			const templates = db
				.prepare('SELECT id, tenant_id, name FROM checklist_templates ORDER BY id')
				.all();
			expect(templates).toEqual([
				{ id: 1, tenant_id: 'default', name: 'morning' },
				{ id: 2, tenant_id: 'default', name: 'evening' },
			]);
		});

		it('activity_logs / daily_missions / activity_mastery / child_activity_preferences の FK target を activities → child_activities に切替える (#2362 PR-3)', () => {
			applyLazyStartupMigrations(db);

			for (const table of [
				'activity_logs',
				'daily_missions',
				'activity_mastery',
				'child_activity_preferences',
			]) {
				const fks = fkTargets(db, table);
				const activityFk = fks.find((fk) => fk.from === 'activity_id');
				expect(activityFk, `${table}.activity_id FK target`).toBeDefined();
				expect(activityFk?.table, `${table}.activity_id FK target`).toBe('child_activities');
			}
		});

		it('既存データを失わずに FK target を切替える (activity_logs の row 数保全)', () => {
			db.prepare("INSERT INTO children (nickname, age) VALUES ('A', 5)").run();
			db.prepare("INSERT INTO activities (name) VALUES ('walk')").run();
			db.prepare("INSERT INTO child_activities (child_id, name) VALUES (1, 'walk-personal')").run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 1, 10, '2026-05-27')",
			).run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 1, 5, '2026-05-26')",
			).run();

			applyLazyStartupMigrations(db);

			const cnt = db.prepare('SELECT COUNT(*) AS c FROM activity_logs').get() as { c: number };
			expect(cnt.c).toBe(2);
		});
	});

	describe('冪等性 — 同じ DB に複数回適用しても no-op (or no-error)', () => {
		it('legacy → new に上げた後、もう一度呼んでも success / 全制約が維持される', () => {
			seedLegacyProductionSchema(db);
			applyLazyStartupMigrations(db);
			// 2 回目: 既に新形式なので全 migration block は guard で skip される
			expect(() => applyLazyStartupMigrations(db)).not.toThrow();

			// 確認: kind 列なし / tenant_id NOT NULL / assignments table / FK target = child_activities
			expect(hasColumn(db, 'checklist_templates', 'kind')).toBe(false);
			expect(hasColumn(db, 'checklist_templates', 'tenant_id')).toBe(true);
			expect(tableExists(db, 'checklist_template_assignments')).toBe(true);

			const fks = fkTargets(db, 'activity_logs');
			expect(fks.find((fk) => fk.from === 'activity_id')?.table).toBe('child_activities');
		});

		it('新規 (empty) DB に対しても no-error で skip する', () => {
			// 何も seed しない (テーブル 0 件)
			expect(() => applyLazyStartupMigrations(db)).not.toThrow();
		});

		it('既に新 schema のみ (kind なし + tenant_id NOT NULL + assignments あり) でも no-op', () => {
			db.pragma('foreign_keys = OFF');
			db.exec(`
				CREATE TABLE children (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL);
				CREATE TABLE checklist_templates (
					id INTEGER PRIMARY KEY,
					tenant_id TEXT NOT NULL DEFAULT 'default',
					name TEXT NOT NULL
				);
				CREATE TABLE checklist_template_assignments (
					id INTEGER PRIMARY KEY,
					template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
					child_id INTEGER NOT NULL REFERENCES children(id)
				);
			`);
			db.pragma('foreign_keys = ON');

			expect(() => applyLazyStartupMigrations(db)).not.toThrow();
			// tenant_id 列が壊れていない
			expect(hasColumn(db, 'checklist_templates', 'tenant_id')).toBe(true);
		});
	});

	describe('foreign_keys pragma 状態の保全', () => {
		it('呼び出し前後で foreign_keys=ON の状態が維持される', () => {
			seedLegacyProductionSchema(db);
			db.pragma('foreign_keys = ON');
			expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

			applyLazyStartupMigrations(db);

			// migration 実行中は OFF にするが、終了時には呼び出し時の状態 (ON) に戻す
			expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
		});

		it('呼び出し前 foreign_keys=OFF だった場合はそれを維持する', () => {
			seedLegacyProductionSchema(db);
			db.pragma('foreign_keys = OFF');
			expect(db.pragma('foreign_keys', { simple: true })).toBe(0);

			applyLazyStartupMigrations(db);

			expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
		});
	});
});
