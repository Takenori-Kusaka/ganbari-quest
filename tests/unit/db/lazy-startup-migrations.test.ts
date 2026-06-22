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

		-- #3194/#3195 deploy 後の NUC 旧 schema に残る auto_challenges (#3213 で DROP 対象)
		CREATE TABLE auto_challenges (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			tenant_id TEXT NOT NULL,
			week_start TEXT NOT NULL,
			category_id INTEGER NOT NULL,
			target_count INTEGER NOT NULL,
			current_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			mode TEXT NOT NULL DEFAULT 'weakness',
			consecutive_miss_count INTEGER NOT NULL DEFAULT 0,
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

		it('legacy auto_challenges テーブルを DROP する (#3213、child_challenges 一本化)', () => {
			// 旧 schema には auto_challenges が存在する
			expect(tableExists(db, 'auto_challenges')).toBe(true);
			db.prepare("INSERT INTO children (nickname, age) VALUES ('A', 8)").run();
			db.prepare(
				"INSERT INTO auto_challenges (child_id, tenant_id, week_start, category_id, target_count) VALUES (1, 'default', '2026-06-22', 1, 3)",
			).run();

			applyLazyStartupMigrations(db);

			// migration 後は auto_challenges が消えている (NUC startup drift 解消)
			expect(tableExists(db, 'auto_challenges')).toBe(false);
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

	describe('transaction rollback on mid-failure (#2509)', () => {
		// 各 migration block は内部で transaction を張るため、ALTER / INSERT / DROP の
		// 途中で fail した場合は SQLite が自動 ROLLBACK し partial state は残らない。
		// partial state が残ると次回起動時 guard 判定 (hasColumn / hasFkToActivities)
		// が破れて永続的 startup loop に陥るため、atomic 化は #2508 の構造的再発防止
		// の核心。本ケースでは「shadow table 作成 → INSERT 途中で table 不在 error」
		// を強制し、ROLLBACK が機能して旧 schema が完全に残ることを検証する。

		it('shadow table が既存と衝突して family flip が fail した場合、旧 schema (child_id 列) が完全に残る', () => {
			seedLegacyProductionSchema(db);
			db.prepare("INSERT INTO children (nickname, age) VALUES ('A', 5)").run();
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, kind) VALUES (1, 'morning', 'belongings')",
			).run();

			// 強制 fail: shadow table と同名の table を先に作っておき、
			// `CREATE TABLE checklist_templates_new (...)` が SQLITE_ERROR で落ちるようにする。
			// これは family flip の step 1 で必ず最初に投げられる DDL なので、
			// tx 内の全 step (INSERT / assignments 作成 / DROP / RENAME) がまだ実行されない
			// ことが確認できる。tx wrap がなければ migrateChecklistTemplatesDropKind の DELETE+
			// DROP COLUMN は既に commit されてしまい、`kind` 列の削除と family flip 部分実装
			// の二重不整合が残る (#2508 と同型の startup loop リスク)。
			db.exec('CREATE TABLE checklist_templates_new (placeholder TEXT);');

			let caught: Error | undefined;
			try {
				applyLazyStartupMigrations(db);
			} catch (err) {
				caught = err as Error;
			}

			// 例外は呼び出し元に伝播されている (fail-fast)
			expect(caught).toBeDefined();
			expect(caught?.message).toMatch(/already exists|checklist_templates_new/);

			// migrateChecklistTemplatesDropKind 自体は family flip の前に走る tx なので
			// 成功して commit 済 (kind 列削除 + 'routine' 行削除)。それは想定挙動。
			expect(hasColumn(db, 'checklist_templates', 'kind')).toBe(false);

			// **核心 assertion**: family flip の tx が ROLLBACK されたため、
			// checklist_templates は旧 schema のまま (child_id 列が残り、tenant_id 不在)、
			// checklist_template_assignments table も作成されていない。
			// partial state (例: assignments 作成済 + 旧 templates もそのまま) は残らない。
			expect(hasColumn(db, 'checklist_templates', 'child_id')).toBe(true);
			expect(hasColumn(db, 'checklist_templates', 'tenant_id')).toBe(false);
			expect(tableExists(db, 'checklist_template_assignments')).toBe(false);

			// 旧 row 数も保全
			const remaining = (
				db.prepare('SELECT COUNT(*) AS c FROM checklist_templates').get() as { c: number }
			).c;
			expect(remaining).toBe(1);
		});
	});

	describe('activities → child_activities data copy (#2510 / #2513 dim 4)', () => {
		/**
		 * PR #2487 後の NUC production を再現する fixture:
		 * - `activities`: 旧 per-table、age_min/age_max + 全 child_activities 互換 column
		 * - `child_activities`: 新 SSOT、空 (= data copy 漏れ状態)
		 * - `activity_logs` 等: FK target は **既に child_activities** (switchover 済) だが
		 *   参照先が空のため全件 orphan
		 *
		 * 本 fixture は switchover 済前提なので、FK target を最初から child_activities に
		 * 設定する (migrateActivityFkSwitchover が no-op になり、data copy だけが走る)。
		 */
		function seedActivitiesDataLossSchema(db: Database.Database): void {
			db.pragma('foreign_keys = OFF');
			db.exec(`
				CREATE TABLE children (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					nickname TEXT NOT NULL,
					age INTEGER NOT NULL DEFAULT 5,
					is_archived INTEGER NOT NULL DEFAULT 0
				);
				CREATE TABLE categories (
					id INTEGER PRIMARY KEY,
					code TEXT NOT NULL UNIQUE,
					name TEXT NOT NULL
				);
				-- 旧 per-table activities (age_min / age_max + 全 copy 対象 column)
				CREATE TABLE activities (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					name TEXT NOT NULL,
					category_id INTEGER REFERENCES categories(id),
					icon TEXT NOT NULL DEFAULT '⭐',
					base_points INTEGER NOT NULL DEFAULT 5,
					is_visible INTEGER NOT NULL DEFAULT 1,
					daily_limit INTEGER,
					sort_order INTEGER NOT NULL DEFAULT 0,
					source TEXT NOT NULL DEFAULT 'seed',
					name_kana TEXT,
					name_kanji TEXT,
					trigger_hint TEXT,
					is_main_quest INTEGER NOT NULL DEFAULT 0,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					is_archived INTEGER NOT NULL DEFAULT 0,
					archived_reason TEXT,
					source_preset_id TEXT,
					priority TEXT NOT NULL DEFAULT 'optional',
					age_min INTEGER,
					age_max INTEGER
				);
				-- 新 SSOT child_activities (create-tables.ts と同形)、空
				CREATE TABLE child_activities (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					child_id INTEGER NOT NULL REFERENCES children(id),
					name TEXT NOT NULL,
					category_id INTEGER REFERENCES categories(id),
					icon TEXT NOT NULL DEFAULT '⭐',
					base_points INTEGER NOT NULL DEFAULT 5,
					is_visible INTEGER NOT NULL DEFAULT 1,
					daily_limit INTEGER,
					sort_order INTEGER NOT NULL DEFAULT 0,
					source TEXT NOT NULL DEFAULT 'seed',
					name_kana TEXT,
					name_kanji TEXT,
					trigger_hint TEXT,
					is_main_quest INTEGER NOT NULL DEFAULT 0,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					is_archived INTEGER NOT NULL DEFAULT 0,
					archived_reason TEXT,
					source_preset_id TEXT,
					priority TEXT NOT NULL DEFAULT 'optional'
				);
				-- FK target は既に child_activities (switchover 済)。checklist_templates は
				-- 新 schema にしておき (kind 無し / tenant_id NOT NULL)、他 migration を no-op 化。
				CREATE TABLE checklist_templates (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					tenant_id TEXT NOT NULL DEFAULT 'default',
					name TEXT NOT NULL
				);
				CREATE TABLE activity_logs (
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
				CREATE TABLE daily_missions (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					child_id INTEGER NOT NULL REFERENCES children(id),
					mission_date TEXT NOT NULL,
					activity_id INTEGER NOT NULL REFERENCES child_activities(id),
					completed INTEGER NOT NULL DEFAULT 0,
					completed_at TEXT
				);
				CREATE TABLE activity_mastery (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					child_id INTEGER NOT NULL REFERENCES children(id),
					activity_id INTEGER NOT NULL REFERENCES child_activities(id),
					total_count INTEGER NOT NULL DEFAULT 0,
					level INTEGER NOT NULL DEFAULT 1,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);
				CREATE TABLE child_activity_preferences (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
					activity_id INTEGER NOT NULL REFERENCES child_activities(id) ON DELETE CASCADE,
					is_pinned INTEGER NOT NULL DEFAULT 0,
					pin_order INTEGER,
					created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);
			`);
			db.pragma('foreign_keys = ON');
		}

		function orphanCount(db: Database.Database, table: string): number {
			return (
				db
					.prepare(
						`SELECT COUNT(*) AS c FROM ${table} t
						 WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = t.activity_id)`,
					)
					.get() as { c: number }
			).c;
		}

		/**
		 * orphan 行 (child_activities に存在しない activity_id を持つ行) を seed する。
		 * NUC では FK switchover (dim 3) で FK target が child_activities に切替わった後、
		 * data copy (dim 4) が漏れたため既存行が全件 orphan 化した状態を再現する。
		 * SQLite は table 再作成時の既存行に FK を再検証しないが、本テストは
		 * `:memory:` で新規 INSERT するため `foreign_keys = OFF` で投入して同状態を作る。
		 */
		function insertOrphanRows(db: Database.Database, fn: () => void): void {
			const before = db.pragma('foreign_keys', { simple: true });
			db.pragma('foreign_keys = OFF');
			try {
				fn();
			} finally {
				db.pragma(`foreign_keys = ${before ? 'ON' : 'OFF'}`);
			}
		}

		/**
		 * 5 年齢モード (baby=1 / preschool=4 / elementary=9 / junior=14 / senior=17) の
		 * child + age 帯の異なる activities 5 件 + in-age/out-of-age 混在 logs 10 件を seed。
		 * (per-child instance のため、年齢ごとに age 適合 copy が分岐することを検証)
		 */
		function seedFiveAgeModeFixture(db: Database.Database): void {
			db.prepare("INSERT INTO categories (id, code, name) VALUES (1, 'undou', '運動')").run();
			// 5 年齢モード代表 child
			const childAges = [
				{ nickname: 'baby', age: 1 },
				{ nickname: 'preschool', age: 4 },
				{ nickname: 'elementary', age: 9 },
				{ nickname: 'junior', age: 14 },
				{ nickname: 'senior', age: 17 },
			];
			for (const c of childAges) {
				db.prepare('INSERT INTO children (nickname, age) VALUES (?, ?)').run(c.nickname, c.age);
			}
			// age 帯の異なる activities 5 件 (age_min/age_max を散らす)
			const acts = [
				{ name: 'all-ages', min: 0, max: 18 },
				{ name: 'preschool-only', min: 3, max: 5 },
				{ name: 'elementary-only', min: 6, max: 12 },
				{ name: 'teen-only', min: 13, max: 18 },
				{ name: 'archived-act', min: 0, max: 18, archived: 1 },
			];
			for (const a of acts) {
				db.prepare(
					'INSERT INTO activities (name, category_id, age_min, age_max, is_archived) VALUES (?, 1, ?, ?, ?)',
				).run(a.name, a.min, a.max, a.archived ?? 0);
			}
		}

		it('referenced (history) ∪ age 適合 activity を child_activities に copy し 4 table を remap する', () => {
			seedActivitiesDataLossSchema(db);
			seedFiveAgeModeFixture(db);

			// elementary child (id=3, age 9) の history を作る: 'elementary-only' (id=3) を参照
			insertOrphanRows(db, () => {
				db.prepare(
					"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (3, 3, 10, '2026-05-27')",
				).run();
				db.prepare(
					"INSERT INTO daily_missions (child_id, mission_date, activity_id) VALUES (3, '2026-05-27', 3)",
				).run();
				db.prepare(
					'INSERT INTO activity_mastery (child_id, activity_id, total_count) VALUES (3, 3, 5)',
				).run();
				db.prepare(
					'INSERT INTO child_activity_preferences (child_id, activity_id, is_pinned) VALUES (3, 3, 1)',
				).run();
				// teen child (id=4, age 14) は 'teen-only' (id=4) の log を持つが age 適合は別途
				db.prepare(
					"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (4, 4, 7, '2026-05-26')",
				).run();
			});

			// 全 4 table が orphan 状態であることを前提確認
			expect(orphanCount(db, 'activity_logs')).toBeGreaterThan(0);

			applyLazyStartupMigrations(db);

			// child_activities が生成された
			const caCount = (
				db.prepare('SELECT COUNT(*) AS c FROM child_activities').get() as { c: number }
			).c;
			expect(caCount).toBeGreaterThan(0);

			// 4 table の orphan = 0
			expect(orphanCount(db, 'activity_logs')).toBe(0);
			expect(orphanCount(db, 'daily_missions')).toBe(0);
			expect(orphanCount(db, 'activity_mastery')).toBe(0);
			expect(orphanCount(db, 'child_activity_preferences')).toBe(0);

			// elementary child (id=3) は referenced 'elementary-only' + age 適合 (all-ages,
			// elementary-only) を持つ。'teen-only' (age 13-18) は age 不適合のため含まれない。
			const elemActs = db
				.prepare(`SELECT ca.name FROM child_activities ca WHERE ca.child_id = 3 ORDER BY ca.name`)
				.all() as { name: string }[];
			const elemNames = elemActs.map((r) => r.name);
			expect(elemNames).toContain('elementary-only'); // referenced + age 適合
			expect(elemNames).toContain('all-ages'); // age 適合
			expect(elemNames).not.toContain('teen-only'); // age 不適合 + 未参照
			expect(elemNames).not.toContain('archived-act'); // archived は age 適合から除外

			// teen child (id=4) は referenced 'teen-only' (age 適合でもある) を必ず持つ (history 保全)
			const teenNames = (
				db.prepare(`SELECT name FROM child_activities WHERE child_id = 4`).all() as {
					name: string;
				}[]
			).map((r) => r.name);
			expect(teenNames).toContain('teen-only');
		});

		it('5 年齢モードそれぞれで age 適合した activity 数が age 帯に応じて分岐する', () => {
			seedActivitiesDataLossSchema(db);
			seedFiveAgeModeFixture(db);
			// 各 child に 1 件ずつ all-ages (id=1) の log を入れ orphan 状態を作る
			insertOrphanRows(db, () => {
				for (let childId = 1; childId <= 5; childId++) {
					db.prepare(
						"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (?, 1, 5, '2026-05-27')",
					).run(childId);
				}
			});

			applyLazyStartupMigrations(db);

			const countFor = (childId: number) =>
				(
					db
						.prepare('SELECT COUNT(*) AS c FROM child_activities WHERE child_id = ?')
						.get(childId) as { c: number }
				).c;

			// preschool (age 4): all-ages + preschool-only = 2
			expect(countFor(2)).toBe(2);
			// elementary (age 9): all-ages + elementary-only = 2
			expect(countFor(3)).toBe(2);
			// junior (age 14): all-ages + teen-only = 2
			expect(countFor(4)).toBe(2);
			// senior (age 17): all-ages + teen-only = 2
			expect(countFor(5)).toBe(2);
			// baby (age 1): all-ages のみ = 1 (preschool-only は age_min 3 で不適合)
			expect(countFor(1)).toBe(1);
		});

		it('冪等性: 2 回実行で child_activities が重複生成されない (no-op)', () => {
			seedActivitiesDataLossSchema(db);
			seedFiveAgeModeFixture(db);
			insertOrphanRows(db, () => {
				db.prepare(
					"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (3, 3, 10, '2026-05-27')",
				).run();
			});

			applyLazyStartupMigrations(db);
			const after1 = (
				db.prepare('SELECT COUNT(*) AS c FROM child_activities').get() as { c: number }
			).c;
			expect(after1).toBeGreaterThan(0);

			// 2 回目: child_activities 非空 guard で skip → 重複生成なし
			expect(() => applyLazyStartupMigrations(db)).not.toThrow();
			const after2 = (
				db.prepare('SELECT COUNT(*) AS c FROM child_activities').get() as { c: number }
			).c;
			expect(after2).toBe(after1);
			// orphan も維持 (0)
			expect(orphanCount(db, 'activity_logs')).toBe(0);
		});

		it('orphan が 1 件も無い場合は data copy を skip する (既正常 DB)', () => {
			seedActivitiesDataLossSchema(db);
			seedFiveAgeModeFixture(db);
			// child_activities を 1 件手動投入し、log もその新 id を指す (orphan ゼロ)
			db.prepare(
				"INSERT INTO child_activities (id, child_id, name, category_id) VALUES (100, 3, 'existing', 1)",
			).run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (3, 100, 10, '2026-05-27')",
			).run();

			applyLazyStartupMigrations(db);

			// child_activities 非空 guard で skip。手動投入の 1 件のみ。
			const caCount = (
				db.prepare('SELECT COUNT(*) AS c FROM child_activities').get() as { c: number }
			).c;
			expect(caCount).toBe(1);
		});

		it('age 列が無い旧 activities schema でも referenced のみで copy + orphan 解消する', () => {
			// age_min/age_max 無しの activities table を再構築
			db.pragma('foreign_keys = OFF');
			db.exec(`
				CREATE TABLE children (id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT NOT NULL, age INTEGER NOT NULL DEFAULT 5, is_archived INTEGER NOT NULL DEFAULT 0);
				CREATE TABLE activities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_archived INTEGER NOT NULL DEFAULT 0);
				CREATE TABLE child_activities (id INTEGER PRIMARY KEY AUTOINCREMENT, child_id INTEGER NOT NULL REFERENCES children(id), name TEXT NOT NULL);
				CREATE TABLE checklist_templates (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default', name TEXT NOT NULL);
				CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, child_id INTEGER NOT NULL REFERENCES children(id), activity_id INTEGER NOT NULL REFERENCES child_activities(id), points INTEGER NOT NULL, recorded_date TEXT NOT NULL);
			`);
			db.pragma('foreign_keys = ON');
			db.prepare("INSERT INTO children (nickname, age) VALUES ('A', 8)").run();
			db.prepare("INSERT INTO activities (name) VALUES ('walk')").run();
			db.prepare("INSERT INTO activities (name) VALUES ('study')").run();
			insertOrphanRows(db, () => {
				db.prepare(
					"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 1, 10, '2026-05-27')",
				).run();
			});

			expect(orphanCount(db, 'activity_logs')).toBe(1);
			applyLazyStartupMigrations(db);

			// referenced 'walk' (id=1) のみ copy。age 列無しなので age 適合 'study' は copy されない。
			const names = (
				db.prepare('SELECT name FROM child_activities WHERE child_id = 1').all() as {
					name: string;
				}[]
			).map((r) => r.name);
			expect(names).toEqual(['walk']);
			expect(orphanCount(db, 'activity_logs')).toBe(0);
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

	// ============================================================
	// #2641 + #2642 / Phase 5 子 3+4 / Phase 6 子 3 #2675 / Phase 7 PR-1:
	// Billing 再設計 expand 段階 (stripe_webhook_events table + archived_reason NULL 補充)
	// ============================================================
	describe('migrateBillingPhase6 (#2641 + #2642 / Phase 7 PR-1)', () => {
		beforeEach(() => {
			seedLegacyProductionSchema(db);
		});

		it('stripe_webhook_events table を新規作成し、event_id PK + 2 index が機能する', () => {
			expect(tableExists(db, 'stripe_webhook_events')).toBe(false);

			applyLazyStartupMigrations(db);

			expect(tableExists(db, 'stripe_webhook_events')).toBe(true);

			// schema 列確認
			const cols = getColumns(db, 'stripe_webhook_events');
			const colNames = cols.map((c) => c.name).sort();
			expect(colNames).toEqual(
				[
					'error_message',
					'event_id',
					'event_type',
					'handler_result',
					'processed_at',
					'retry_count',
					'tenant_id',
				].sort(),
			);

			// PK 機能確認: event_id 重複 insert は fail
			db.prepare(
				`INSERT INTO stripe_webhook_events (event_id, event_type, handler_result)
				 VALUES ('evt_1ABC', 'checkout.session.completed', 'success')`,
			).run();
			expect(() => {
				db.prepare(
					`INSERT INTO stripe_webhook_events (event_id, event_type, handler_result)
					 VALUES ('evt_1ABC', 'invoice.paid', 'success')`,
				).run();
			}).toThrow(/UNIQUE constraint failed/);

			// 2 index 確認 (sqlite_master から index 取得)
			const indices = (
				db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stripe_webhook_events' ORDER BY name",
					)
					.all() as { name: string }[]
			).map((r) => r.name);
			expect(indices).toContain('idx_stripe_webhook_events_processed_at');
			expect(indices).toContain('idx_stripe_webhook_events_type_result');
		});

		it('既存 archived レコードの NULL archived_reason を downgrade_user_selected で補充する (4 location)', () => {
			// 補充前: legacy schema には is_archived / archived_reason 列がない可能性があるため
			// child_activities を含む 4 location を直接 patch
			db.exec(`
				ALTER TABLE children ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE children ADD COLUMN archived_reason TEXT;
				ALTER TABLE activities ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE activities ADD COLUMN archived_reason TEXT;
				ALTER TABLE child_activities ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE child_activities ADD COLUMN archived_reason TEXT;
			`);

			// 各 table に「archived だが reason NULL」の row を seed
			db.prepare(
				"INSERT INTO children (nickname, age, is_archived, archived_reason) VALUES ('legacy-archived', 10, 1, NULL)",
			).run();
			db.prepare(
				"INSERT INTO children (nickname, age, is_archived, archived_reason) VALUES ('active', 8, 0, NULL)",
			).run();
			db.prepare(
				"INSERT INTO activities (name, is_archived, archived_reason) VALUES ('legacy-act', 1, NULL)",
			).run();
			db.prepare(
				"INSERT INTO child_activities (child_id, name, is_archived, archived_reason) VALUES (1, 'legacy-ca', 1, NULL)",
			).run();

			applyLazyStartupMigrations(db);

			// archived 1 row は補充される
			const childArchived = db
				.prepare("SELECT archived_reason FROM children WHERE nickname = 'legacy-archived'")
				.get() as { archived_reason: string };
			expect(childArchived.archived_reason).toBe('downgrade_user_selected');

			// active row (is_archived = 0) は NULL のまま (補充されない)
			const childActive = db
				.prepare("SELECT archived_reason FROM children WHERE nickname = 'active'")
				.get() as { archived_reason: string | null };
			expect(childActive.archived_reason).toBeNull();

			// activities / child_activities も同様に補充される
			const actArchived = db
				.prepare("SELECT archived_reason FROM activities WHERE name = 'legacy-act'")
				.get() as { archived_reason: string };
			expect(actArchived.archived_reason).toBe('downgrade_user_selected');

			const caArchived = db
				.prepare("SELECT archived_reason FROM child_activities WHERE name = 'legacy-ca'")
				.get() as { archived_reason: string };
			expect(caArchived.archived_reason).toBe('downgrade_user_selected');
		});

		it('複数回呼んでも idempotent (table 再作成しない + 既補充 reason を上書きしない)', () => {
			db.exec(`
				ALTER TABLE children ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE children ADD COLUMN archived_reason TEXT;
			`);
			db.prepare(
				"INSERT INTO children (nickname, age, is_archived, archived_reason) VALUES ('a', 5, 1, 'trial_expired')",
			).run();

			applyLazyStartupMigrations(db);
			// 既に reason 設定済の row は上書きしない (idempotent)
			const after1 = db
				.prepare("SELECT archived_reason FROM children WHERE nickname = 'a'")
				.get() as { archived_reason: string };
			expect(after1.archived_reason).toBe('trial_expired');

			// 2 回目: table 既存 → 作成 skip、archived row 既補充 → UPDATE noop
			applyLazyStartupMigrations(db);
			expect(tableExists(db, 'stripe_webhook_events')).toBe(true);
			const after2 = db
				.prepare("SELECT archived_reason FROM children WHERE nickname = 'a'")
				.get() as { archived_reason: string };
			expect(after2.archived_reason).toBe('trial_expired');
		});
	});
});
