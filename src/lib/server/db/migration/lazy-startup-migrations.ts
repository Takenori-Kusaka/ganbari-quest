// src/lib/server/db/migration/lazy-startup-migrations.ts
//
// startup 時に **`SQL_CREATE_TABLES` (create-tables.ts) より前** に実行する
// shadow-table recreation 系 / DROP COLUMN 系の lazy migration 集約 SSOT。
//
// ## 設計背景 (NUC startup failure 2026-05-27)
//
// `schema-validator.ts` (`validateAndMigrate`) は **個別カラム追加**
// (`ALTER TABLE ADD COLUMN`) のみ対応する (SQLite ADR-0031)。一方、
// SQLite では以下の operation はサポートされない / 制約がある:
//
// - `ALTER TABLE DROP COLUMN` (SQLite 3.35+ で限定対応、複雑な制約あり)
// - `ALTER TABLE` で FK target 変更 (不可能)
// - `ALTER TABLE` で NOT NULL 制約変更 (不可能)
//
// これらは **shadow table recreation pattern** (旧 table の隣に新 schema の
// `*_new` を作って `INSERT ... SELECT` → `DROP old` → `RENAME new` → re-create
// indexes) で対応する必要がある。
//
// PR #2480 (#2362 PR-5 Phase 1) で `checklist_templates` を
// per-child instance (child_id NOT NULL) から family master (tenant_id NOT NULL)
// に flip した際、本来 startup の `SQL_CREATE_TABLES` より **前** にこの
// shadow-table recreation を実行する必要があったが、scripts/migrate-local.ts
// にしか実装されておらず NUC startup から呼ばれていなかった。結果、
// `SQL_CREATE_TABLES` 内の `CREATE INDEX ... ON checklist_templates(tenant_id, ...)`
// が `no such column: tenant_id` で失敗し、`validateAndMigrate` に到達せず
// app 起動が完全に block された。
//
// ## 責務分離 (3 dimension SSOT、再発防止 Issue)
//
// schema 変更 PR では以下 **3 file** を必ず同期更新する:
//
// 1. `src/lib/server/db/schema.ts` — drizzle table 定義 (TypeScript 型 SSOT)
// 2. `src/lib/server/db/create-tables.ts` — `CREATE TABLE/INDEX IF NOT EXISTS`
//    群 (新規 DB / dev / CI 用の素朴 init)
// 3. **`src/lib/server/db/migration/lazy-startup-migrations.ts` (本 file)** —
//    既存 production DB を新 schema にアップグレードする shadow-table
//    recreation / DROP COLUMN 系 migration
//
// (1) と (2) を更新しただけでは既存 production DB は壊れる。本 file の更新
// 漏れは NUC startup blocking という形で爆発するため、schema 破壊変更 PR は
// 必ず本 file へ migration を追加すること。
//
// ## 実行順序
//
// `client.ts` で SQLite mode 時に以下の順序で実行:
//
// 1. `applyLazyStartupMigrations(sqlite)` ← **本 file**
//    既存 production DB の旧 schema を新 schema 互換に揃える
// 2. `sqlite.exec(SQL_CREATE_TABLES)`
//    新規 table / index を idempotent に作成
// 3. `validateAndMigrate(sqlite)`
//    drizzle schema との差分検出 + 安全な `ALTER TABLE ADD COLUMN` 自動適用
//
// ## 冪等性
//
// 各 migration block は `tableExists` / `hasColumn` / `hasFkToActivities`
// 等の guard で「既に新形式なら skip」を保証する。複数回呼んでも no-op。

import type Database from 'better-sqlite3';

interface ColumnInfo {
	name: string;
}

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

function tableExists(db: Database.Database, name: string): boolean {
	return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
	if (!tableExists(db, table)) return false;
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
	return cols.some((c) => c.name === column);
}

function hasFkToActivities(db: Database.Database, table: string): boolean {
	if (!tableExists(db, table)) return false;
	const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyInfo[];
	return fks.some((fk) => fk.from === 'activity_id' && fk.table === 'activities');
}

/**
 * #1755 (#1709-A) 後半: `checklist_templates.kind` 列削除 + 旧 'routine' レコード drop。
 * 持ち物純化 (旧 routine は `activities.priority='must'` に役割移管)。
 *
 * #2509 fix: DELETE + DROP COLUMN を transaction で囲み、片方だけ成功して
 * 不整合 (routine 行は消えたが kind 列が残っている等) を残さない。
 */
function migrateChecklistTemplatesDropKind(db: Database.Database): void {
	// guard (read-only): tx 外で OK
	if (!tableExists(db, 'checklist_templates') || !hasColumn(db, 'checklist_templates', 'kind')) {
		return;
	}
	const run = db.transaction(() => {
		const dropped = db.prepare("DELETE FROM checklist_templates WHERE kind = 'routine'").run();
		console.info(
			`[lazy-migrate #1755] deleted ${dropped.changes} legacy 'routine' rows from checklist_templates`,
		);
		db.exec('ALTER TABLE checklist_templates DROP COLUMN kind;');
		console.info('[lazy-migrate #1755] dropped checklist_templates.kind column');
	});
	run();
}

/**
 * #2362 PR-3 (Phase 7b-2a): activity 系テーブルの FK target を
 * 旧 `activities` から `child_activities` に切替。
 *
 * SQLite は FK target 変更を直接サポートしないため shadow table 再作成 pattern。
 * `child_activity_preferences` のみ ON DELETE CASCADE を維持。
 *
 * 対象: activity_logs / daily_missions / activity_mastery / child_activity_preferences
 *
 * #2509 fix: 各 sub-table の shadow-table recreation を transaction で囲み、
 * 例えば INSERT 中に fail した場合に `*_new` だけ残って旧 table と二重存在
 * (次回起動で `CREATE INDEX ... ON activity_logs(...)` が `no such table` で
 * fail する等) する不整合を防ぐ。各 sub-table は独立 tx (1 つ失敗しても他は
 * 既に commit 済み or skip)、tx 内で例外が起きると better-sqlite3 は自動 ROLLBACK
 * する。
 */
function migrateActivityFkSwitchover(db: Database.Database): void {
	const needs =
		hasFkToActivities(db, 'activity_logs') ||
		hasFkToActivities(db, 'daily_missions') ||
		hasFkToActivities(db, 'activity_mastery') ||
		hasFkToActivities(db, 'child_activity_preferences');
	if (!needs) return;

	console.info(
		'[lazy-migrate #2362-PR3] switching activity_id FK target: activities → child_activities',
	);

	if (hasFkToActivities(db, 'activity_logs')) {
		const run = db.transaction(() => {
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
		});
		run();
		console.info('[lazy-migrate #2362-PR3]   → activity_logs done');
	}

	if (hasFkToActivities(db, 'daily_missions')) {
		const run = db.transaction(() => {
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
		});
		run();
		console.info('[lazy-migrate #2362-PR3]   → daily_missions done');
	}

	if (hasFkToActivities(db, 'activity_mastery')) {
		const run = db.transaction(() => {
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
		});
		run();
		console.info('[lazy-migrate #2362-PR3]   → activity_mastery done');
	}

	if (hasFkToActivities(db, 'child_activity_preferences')) {
		const run = db.transaction(() => {
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
		});
		run();
		console.info('[lazy-migrate #2362-PR3]   → child_activity_preferences done');
	}
}

/**
 * #2362 PR-5 (Phase 1): `checklist_templates` flip
 *
 * - 旧: `checklist_templates.child_id NOT NULL` (per-child instance)
 * - 新: `tenant_id NOT NULL` 列追加 + `child_id` 列削除
 *   + `checklist_template_assignments` 新規 (template ↔ child N:M binding)
 *
 * 既存 per-child template は family master + assignment 1 行に変換。
 * `checklist_logs` / `checklist_overrides` の `child_id` は維持 (per-child
 * progress / override の事実履歴)。
 *
 * SSOT: docs/design/data-model-resource-scope.md §4.2
 */
function migrateChecklistTemplatesFamilyFlip(db: Database.Database): void {
	// guard (read-only): tx 外で OK
	if (
		!tableExists(db, 'checklist_templates') ||
		!hasColumn(db, 'checklist_templates', 'child_id')
	) {
		return;
	}

	console.info('[lazy-migrate #2362-PR5] flipping checklist_templates: per-child → family master');

	const hasTenantId = hasColumn(db, 'checklist_templates', 'tenant_id');

	// #2509 fix: 4 step (shadow CREATE → INSERT → assignments + populate → DROP/RENAME) を
	// 単一 tx で囲む。step 2/3 で fail した場合に shadow table (`*_new`) や中途半端な
	// assignments が残ると、次回起動時の guard (`hasColumn('child_id')`) は false に
	// なり migration skip するが、`SQL_CREATE_TABLES` 内の `CREATE INDEX ... ON
	// checklist_templates(tenant_id, ...)` が「shadow rename されておらず tenant_id 列
	// 不在」で fail し永続的 startup loop (Issue #2508 と同型) に陥る。tx で全 step 失敗
	// 時に ROLLBACK させ、再起動時にも旧 schema から再度 migrate 試行可能な状態を保つ。
	const run = db.transaction(() => {
		// 1. 新 schema の shadow table を作成 (create-tables.ts と同一形状)
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

		// 2. 既存 row を移行。tenant_id 既存値 or 'default'。
		//    time_slot / is_archived は旧 schema で nullable だった可能性があるので COALESCE で補完。
		if (hasTenantId) {
			db.exec(`
				INSERT INTO checklist_templates_new
					(id, tenant_id, name, icon, points_per_item, completion_bonus, time_slot, is_active,
					 created_at, updated_at, is_archived, archived_reason, source_preset_id)
				SELECT id, COALESCE(tenant_id, 'default'), name, icon, points_per_item, completion_bonus,
					COALESCE(time_slot, 'anytime'), is_active, created_at, updated_at,
					COALESCE(is_archived, 0), archived_reason, source_preset_id FROM checklist_templates;
			`);
		} else {
			db.exec(`
				INSERT INTO checklist_templates_new
					(id, tenant_id, name, icon, points_per_item, completion_bonus, time_slot, is_active,
					 created_at, updated_at, is_archived, archived_reason, source_preset_id)
				SELECT id, 'default', name, icon, points_per_item, completion_bonus,
					COALESCE(time_slot, 'anytime'), is_active, created_at, updated_at,
					COALESCE(is_archived, 0), archived_reason, source_preset_id FROM checklist_templates;
			`);
		}

		// 3. 旧 per-child template の child_id 値を assignments 1 row に移行
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
		console.info(
			`[lazy-migrate #2362-PR5]   migrated ${assignmentCount} per-child rows to template_assignments`,
		);

		// 4. 旧 table を drop + new を rename + index 再作成
		db.exec(`
			DROP TABLE checklist_templates;
			ALTER TABLE checklist_templates_new RENAME TO checklist_templates;
			CREATE INDEX IF NOT EXISTS idx_checklist_templates_tenant_archived
				ON checklist_templates(tenant_id, is_archived);
		`);
	});
	run();
	console.info('[lazy-migrate #2362-PR5]   → flip complete');
}

/**
 * startup 時に `SQL_CREATE_TABLES` 実行より **前** に呼ぶ。
 *
 * - 各 migration は冪等 (既に新形式なら skip)
 * - 各 migration block は内部で **transaction (BEGIN ... COMMIT)** を張る (#2509)。
 *   ALTER TABLE / DROP TABLE / RENAME / INSERT が途中で fail した場合は SQLite が
 *   自動 ROLLBACK し、partial state を残さない。partial state が残ると次回起動時
 *   guard 判定が破れて startup loop に陥る (Issue #2508 と同型のリスク) ため、
 *   atomic 化は必須。
 * - 全 migration を `foreign_keys = OFF` 下で実行 (shadow table 再作成中の
 *   FK 整合性 trip を回避)
 * - 終了時に `foreign_keys = ON` に必ず戻す
 * - エラー時は呼び出し元 (`client.ts`) に伝播し、`SCHEMA_VALIDATION_MODE`
 *   分岐で process.exit するか継続するかを判断する。fail-fast 原則: partial state
 *   で app を起動させない。
 *
 * 注: 本 helper は単一 SQLite ファイル (NUC / local dev) を前提。
 *     DynamoDB バックエンドでは呼ばない。
 */
export function applyLazyStartupMigrations(db: Database.Database): void {
	const fkBefore = db.pragma('foreign_keys', { simple: true }) as number;
	db.pragma('foreign_keys = OFF');
	try {
		migrateChecklistTemplatesDropKind(db);
		migrateActivityFkSwitchover(db);
		migrateChecklistTemplatesFamilyFlip(db);
	} catch (err) {
		// #2509: tx 内で失敗した場合 better-sqlite3 が自動 ROLLBACK 済。partial state
		// は残らないが、後続の `SQL_CREATE_TABLES` / `validateAndMigrate` 実行は危険
		// (整合性が確定しないため) なので呼び出し元に再 throw し fail-fast させる。
		console.error('[lazy-migrate] migration failed and rolled back; aborting startup', err);
		throw err;
	} finally {
		// shadow-table recreation 中の FK 制約 trip を防ぐため OFF にしたが、
		// 終了時に必ず元 (通常 ON) に戻す。
		db.pragma(`foreign_keys = ${fkBefore ? 'ON' : 'OFF'}`);
	}
}
