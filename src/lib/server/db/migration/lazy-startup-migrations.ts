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
// ## 責務分離 (4 dimension SSOT、再発防止 Issue #2508 / #2510)
//
// schema 変更 PR では以下 **4 dimension** を必ず同期更新する (詳細:
// docs/design/08-データベース設計書.md §8.6):
//
// 1. `src/lib/server/db/schema.ts` — drizzle table 定義 (TypeScript 型 SSOT)
// 2. `src/lib/server/db/create-tables.ts` — `CREATE TABLE/INDEX IF NOT EXISTS`
//    群 (新規 DB / dev / CI 用の素朴 init)
// 3. **`src/lib/server/db/migration/lazy-startup-migrations.ts` (本 file、structural)** —
//    既存 production DB の schema 形状を新 schema に合わせる shadow-table
//    recreation / DROP COLUMN / FK target switch / NOT NULL 変更
//    (例: `migrateActivityFkSwitchover`)
// 4. **`src/lib/server/db/migration/lazy-startup-migrations.ts` (本 file、data copy)** —
//    cross-table semantic flip 時に row 自体を旧 table 群から新 table 群へ
//    再配置する data migration (例: `migrateActivitiesLegacyDataCopy`、
//    旧 per-table `activities` → per-child `child_activities`)
//
// (1)(2) を更新しただけでは既存 production DB は壊れる。dim 3 の漏れは NUC
// startup blocking (Issue #2508 / PR #2480)、dim 4 の漏れは既存 data の orphan 化
// = user history 完全消失 (Issue #2510 / PR #2487) という形で爆発するため、
// schema 破壊変更 PR は必ず本 file へ structural + (cross-table flip 時は) data copy
// migration を追加すること。
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
 * #3213 (EPIC #3193): `auto_challenges` テーブル DROP。週次自動生成チャレンジは
 * `child_challenges` へ一本化 (#3195) され、`auto_challenges` は読み取り経路ゼロの
 * 冗長テーブルとなった。#3194/#3195 deploy 後の既存 NUC DB には本テーブルが残るため、
 * 新 schema (auto_challenges 不在) との drift で startup block (#2508 同型) を起こさぬよう
 * 起動時に DROP する。data loss は許容 (生成チャレンジは child_challenges 側に存続)。
 *
 * 冪等: テーブル不在なら skip。DROP は transaction で囲み partial state を残さない (#2509)。
 */
function migrateDropAutoChallenges(db: Database.Database): void {
	// guard (read-only): tx 外で OK
	if (!tableExists(db, 'auto_challenges')) {
		return;
	}
	const run = db.transaction(() => {
		// 関連 index も table 削除に伴い消えるが、念のため明示 drop (IF EXISTS で冪等)
		db.exec('DROP TABLE IF EXISTS auto_challenges;');
		console.info('[lazy-migrate #3213] dropped legacy auto_challenges table');
	});
	run();
}

function indexExists(db: Database.Database, name: string): boolean {
	return !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?").get(name);
}

/**
 * #3245: child_challenges の auto:weekly に (child_id, start_date) 部分 unique index を復活。
 * 旧 auto_challenges の UNIQUE(child_id, week_start) が #3213/#3220 一本化で喪失していたため、
 * concurrent 二重 INSERT (= ポイント二重付与) を DB レベルで不可能化する。
 *
 * 既存 production DB に重複行があると CREATE UNIQUE INDEX が失敗するため、
 * 先に重複 auto:weekly 行を dedup (各 child×start_date で最小 id を残し他を削除) してから index 作成。
 * 冪等: index 既存なら skip。
 */
function migrateChildChallengeAutoWeeklyUnique(db: Database.Database): void {
	if (!tableExists(db, 'child_challenges')) return;
	if (indexExists(db, 'idx_child_challenges_auto_weekly_unique')) return;

	const run = db.transaction(() => {
		// dedup: 同一 (child_id, start_date) の auto:weekly 行のうち最小 id 以外を削除
		const dedup = db
			.prepare(`
			DELETE FROM child_challenges
			WHERE source_template_id = 'auto:weekly'
			  AND id NOT IN (
				SELECT MIN(id) FROM child_challenges
				WHERE source_template_id = 'auto:weekly'
				GROUP BY child_id, start_date
			  )
		`)
			.run();
		if (dedup.changes > 0) {
			console.info(
				`[lazy-migrate #3245] deduped ${dedup.changes} duplicate auto:weekly child_challenges rows`,
			);
		}
		db.exec(
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_child_challenges_auto_weekly_unique
			 ON child_challenges(child_id, start_date) WHERE source_template_id = 'auto:weekly';`,
		);
		console.info(
			'[lazy-migrate #3245] created partial unique index for auto:weekly child_challenges',
		);
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
 * 旧 `activities` table が持つ column のうち `child_activities` へ copy 可能な
 * ものを実 DB から検出して返す (startup 時 schema 検証より **前** に走るため、
 * 旧 production DB の `activities` / `child_activities` が一部 column を欠く場合に備える)。
 *
 * **source (`activities`) と target (`child_activities`) の両方に存在する** column
 * のみを対象にする (片方にしか無い列を SELECT/INSERT すると `no such column` で fail)。
 */
function detectCopyableActivityColumns(db: Database.Database): string[] {
	// child_activities へ copy する候補 (child_id は固定で別途指定するため除外)。
	const candidate = [
		'name',
		'category_id',
		'icon',
		'base_points',
		'is_visible',
		'daily_limit',
		'sort_order',
		'source',
		'name_kana',
		'name_kanji',
		'trigger_hint',
		'is_main_quest',
		'created_at',
		'is_archived',
		'archived_reason',
		'source_preset_id',
		'priority',
	];
	return candidate.filter(
		(col) => hasColumn(db, 'activities', col) && hasColumn(db, 'child_activities', col),
	);
}

/**
 * #2487 (#2458-A1) follow-up / Issue #2510 / #2513: legacy `activities` rows を
 * per-child `child_activities` に copy する **data copy migration** (4 dimension
 * SSOT の dim 4)。
 *
 * ## 背景
 *
 * PR #2487 で activity-repo facade を旧 per-table `activities` から per-child
 * `child_activities` に flip した際、**既存 production DB の `activities` 行を
 * `child_activities` へ copy する data migration が完全に漏れていた**。結果 NUC で:
 *
 * - `activities`: 191 行 (旧 table、read 経路なし)
 * - `child_activities`: 0 行 (新 SSOT、空)
 * - `activity_logs` / `daily_missions` / `activity_mastery`
 *   / `child_activity_preferences`: FK target は `child_activities` だが
 *   参照先 row が存在せず全件 orphan → UI 表示 0 + history 完全消失
 *
 * `migrateActivityFkSwitchover` (dim 3 / structural) は FK target を切替える
 * **だけ** で、row 自体の移動は行わない。本関数は **switchover の後** に走り、
 * 旧 `activities` の row を各 child の `child_activities` に複製してから 4 table の
 * `activity_id` を remap する。
 *
 * ## 復旧方針 (RCA Phase B' Option C / `scripts/recover-activities-data.mjs` と同一)
 *
 * 各 child について以下 2 集合の和を `child_activities` に copy する:
 *   (a) referenced — 既往 `activity_logs` / `daily_missions` / `activity_mastery`
 *       / `child_activity_preferences` で参照されている activity (**history 保全**)
 *   (b) age 適合 — `age_min ≤ child.age ≤ age_max` かつ未 archive の activity
 *       (UI 一覧表示用)。`activities` に age 列が無い古い schema では全件 (a) のみ
 *
 * その後 `(old activity_id, child_id) → new child_activity_id` mapping を構築し、
 * 4 table の `activity_id` を remap。最後に orphan = 0 を assert (throw で
 * DB 整合性を保護)。
 *
 * ## guards (冪等性)
 *
 * - `activities` / `child_activities` / `children` のいずれかが不在 → skip
 * - `child_activities` が非空 (既 copy 済) → skip
 * - 4 table いずれにも orphan が無い → skip (copy 不要)
 *
 * ## SSOT 注記
 *
 * 本関数は SvelteKit startup 経路 (`client.ts`) の **恒久 data copy SSOT**。
 * NUC container で TS toolchain 無しに単発実行する緊急復旧版は
 * `scripts/recover-activities-data.mjs` に存在する (runtime が異なるため import 共有
 * 不可、SQL logic を同期させること)。詳細: docs/runbooks/activities-data-recovery.md /
 * docs/design/08-データベース設計書.md §8.6。
 */
function migrateActivitiesLegacyDataCopy(db: Database.Database): void {
	// --- guard 1: 必要 table が揃っていない (新規 DB / 旧 table 未作成) → skip ---
	if (
		!tableExists(db, 'activities') ||
		!tableExists(db, 'child_activities') ||
		!tableExists(db, 'children')
	) {
		return;
	}

	// --- guard 2: child_activities が既に非空 (= 既 copy 済 or 新規 seed 済) → skip ---
	const childActivitiesCount = (
		db.prepare('SELECT COUNT(*) AS c FROM child_activities').get() as { c: number }
	).c;
	if (childActivitiesCount > 0) return;

	// --- guard 3: 旧 activities が空 → copy 元なし → skip ---
	const activitiesCount = (
		db.prepare('SELECT COUNT(*) AS c FROM activities').get() as { c: number }
	).c;
	if (activitiesCount === 0) return;

	// --- guard 4: 4 table に orphan が 1 件も無ければ data copy 不要 → skip ---
	// (FK switchover 済だが参照対象が無い = orphan。orphan ゼロなら移行不要)
	const hasLogTable = tableExists(db, 'activity_logs');
	const hasMissionTable = tableExists(db, 'daily_missions');
	const hasMasteryTable = tableExists(db, 'activity_mastery');
	const hasPrefTable = tableExists(db, 'child_activity_preferences');

	const orphanBefore = countOrphans(db, {
		hasLogTable,
		hasMissionTable,
		hasMasteryTable,
		hasPrefTable,
	});
	if (
		orphanBefore.logs === 0 &&
		orphanBefore.missions === 0 &&
		orphanBefore.mastery === 0 &&
		orphanBefore.prefs === 0
	) {
		return;
	}

	const presence: OrphanTablePresence = {
		hasLogTable,
		hasMissionTable,
		hasMasteryTable,
		hasPrefTable,
	};

	console.info(
		`[lazy-migrate #2510] copying legacy activities → child_activities ` +
			`(activities=${activitiesCount}, orphans: logs=${orphanBefore.logs} ` +
			`missions=${orphanBefore.missions} mastery=${orphanBefore.mastery} prefs=${orphanBefore.prefs})`,
	);

	const run = db.transaction(() => {
		const mapping = copyAllChildActivities(db, presence);

		// 4 table の activity_id を (child_id, old activity_id) → new child_activity id に remap
		for (const [tableName, present] of [
			['activity_logs', hasLogTable],
			['daily_missions', hasMissionTable],
			['activity_mastery', hasMasteryTable],
			['child_activity_preferences', hasPrefTable],
		] as const) {
			if (present) remapActivityIdColumn(db, tableName, mapping);
		}

		// post-condition: orphan = 0 を assert。残れば throw → tx ROLLBACK (整合性保護)。
		assertNoOrphansRemain(db, presence);
	});
	run();
	console.info('[lazy-migrate #2510]   → activities data copy complete (orphan = 0)');
}

/**
 * 全 child について copy 対象 activity を `child_activities` に INSERT し、
 * `(childId:oldActivityId) → new child_activity id` の mapping を返す。
 */
function copyAllChildActivities(
	db: Database.Database,
	presence: OrphanTablePresence,
): Map<string, number | bigint> {
	const { hasLogTable, hasMissionTable, hasMasteryTable, hasPrefTable } = presence;
	const copyableCols = detectCopyableActivityColumns(db);
	const hasAge =
		hasColumn(db, 'children', 'age') &&
		hasColumn(db, 'activities', 'age_min') &&
		hasColumn(db, 'activities', 'age_max');

	// child_activities への INSERT (検出した column のみ、child_id は固定で先頭指定)。
	const insertCols = ['child_id', ...copyableCols];
	const selectCols = copyableCols.map((c) => `a.${c}`).join(', ');
	const insertStmt = db.prepare(
		`INSERT INTO child_activities (${insertCols.join(', ')})
		 SELECT ?${selectCols ? `, ${selectCols}` : ''} FROM activities a WHERE a.id = ?`,
	);

	// referenced: 既往 4 table で参照されている activity_id (history 保全)。
	// table 不在は `SELECT NULL WHERE 0` で空集合化し、placeholder の余分引数も無害。
	const referencedStmt = db.prepare(`
		SELECT DISTINCT activity_id FROM (
			${hasLogTable ? 'SELECT activity_id FROM activity_logs WHERE child_id = ? UNION' : 'SELECT NULL AS activity_id WHERE 0 UNION'}
			${hasMissionTable ? 'SELECT activity_id FROM daily_missions WHERE child_id = ? UNION' : 'SELECT NULL WHERE 0 UNION'}
			${hasMasteryTable ? 'SELECT activity_id FROM activity_mastery WHERE child_id = ? UNION' : 'SELECT NULL WHERE 0 UNION'}
			${hasPrefTable ? 'SELECT activity_id FROM child_activity_preferences WHERE child_id = ?' : 'SELECT NULL WHERE 0'}
		) WHERE activity_id IS NOT NULL
	`);

	// age 適合 activity (UI 一覧用)。age 列が無い旧 schema では null (referenced のみ)。
	const ageFitStmt = hasAge
		? db.prepare(`
			SELECT id FROM activities
			WHERE (age_min IS NULL OR age_min <= ?)
				AND (age_max IS NULL OR age_max >= ?)
				AND COALESCE(is_archived, 0) = 0
		`)
		: null;

	const children = db
		.prepare('SELECT id, age FROM children WHERE COALESCE(is_archived, 0) = 0')
		.all() as { id: number; age: number | null }[];

	const mapping = new Map<string, number | bigint>();
	let totalCopied = 0;
	for (const child of children) {
		totalCopied += copyChildActivities(child, presence, {
			insertStmt,
			referencedStmt,
			ageFitStmt,
			mapping,
		});
	}
	console.info(
		`[lazy-migrate #2510]   inserted ${totalCopied} child_activities rows (mapping size: ${mapping.size})`,
	);
	return mapping;
}

interface CopyStatements {
	insertStmt: Database.Statement;
	referencedStmt: Database.Statement;
	ageFitStmt: Database.Statement | null;
	mapping: Map<string, number | bigint>;
}

/**
 * 1 child について referenced ∪ age 適合 の activity 集合を `child_activities` に
 * INSERT し mapping に登録。copy 件数を返す。
 */
function copyChildActivities(
	child: { id: number; age: number | null },
	presence: OrphanTablePresence,
	stmts: CopyStatements,
): number {
	const { insertStmt, referencedStmt, ageFitStmt, mapping } = stmts;
	const activityIdSet = new Set<number>();

	// referenced (存在 table 分だけ child.id を bind)
	const refArgs: number[] = [];
	if (presence.hasLogTable) refArgs.push(child.id);
	if (presence.hasMissionTable) refArgs.push(child.id);
	if (presence.hasMasteryTable) refArgs.push(child.id);
	if (presence.hasPrefTable) refArgs.push(child.id);
	for (const r of referencedStmt.all(...refArgs) as { activity_id: number }[]) {
		activityIdSet.add(r.activity_id);
	}

	// age 適合
	if (ageFitStmt && child.age != null) {
		for (const r of ageFitStmt.all(child.age, child.age) as { id: number }[]) {
			activityIdSet.add(r.id);
		}
	}

	let copied = 0;
	for (const oldActivityId of activityIdSet) {
		const result = insertStmt.run(child.id, oldActivityId);
		if (result.changes > 0) {
			mapping.set(`${child.id}:${oldActivityId}`, result.lastInsertRowid);
			copied++;
		}
	}
	return copied;
}

/**
 * data copy 後 4 table に orphan が残っていれば throw (tx ROLLBACK で整合性保護)。
 */
function assertNoOrphansRemain(db: Database.Database, presence: OrphanTablePresence): void {
	const orphanAfter = countOrphans(db, presence);
	if (
		orphanAfter.logs > 0 ||
		orphanAfter.missions > 0 ||
		orphanAfter.mastery > 0 ||
		orphanAfter.prefs > 0
	) {
		throw new Error(
			`[lazy-migrate #2510] ORPHAN remains after data copy — ROLLBACK. ` +
				`logs=${orphanAfter.logs} missions=${orphanAfter.missions} ` +
				`mastery=${orphanAfter.mastery} prefs=${orphanAfter.prefs}`,
		);
	}
}

/**
 * 1 つの table の `activity_id` を `(child_id, old activity_id) → new child_activity id`
 * mapping で remap する。mapping に無い行は触らない (既に新 id か、対象外)。
 */
function remapActivityIdColumn(
	db: Database.Database,
	tableName: 'activity_logs' | 'daily_missions' | 'activity_mastery' | 'child_activity_preferences',
	mapping: Map<string, number | bigint>,
): void {
	const update = db.prepare(`UPDATE ${tableName} SET activity_id = ? WHERE id = ?`);
	const rows = db.prepare(`SELECT id, child_id, activity_id FROM ${tableName}`).all() as {
		id: number;
		child_id: number;
		activity_id: number;
	}[];
	let remapped = 0;
	for (const row of rows) {
		const newId = mapping.get(`${row.child_id}:${row.activity_id}`);
		if (newId !== undefined) {
			update.run(newId, row.id);
			remapped++;
		}
	}
	console.info(`[lazy-migrate #2510]   ${tableName} remapped: ${remapped} / ${rows.length}`);
}

interface OrphanTablePresence {
	hasLogTable: boolean;
	hasMissionTable: boolean;
	hasMasteryTable: boolean;
	hasPrefTable: boolean;
}

/**
 * 4 table それぞれについて `child_activities` に存在しない `activity_id` を持つ
 * 行 (= orphan) 件数を返す。table 不在時は 0。
 */
function countOrphans(
	db: Database.Database,
	presence: OrphanTablePresence,
): { logs: number; missions: number; mastery: number; prefs: number } {
	const orphanCount = (table: string): number =>
		(
			db
				.prepare(
					`SELECT COUNT(*) AS c FROM ${table} t
					 WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = t.activity_id)`,
				)
				.get() as { c: number }
		).c;
	return {
		logs: presence.hasLogTable ? orphanCount('activity_logs') : 0,
		missions: presence.hasMissionTable ? orphanCount('daily_missions') : 0,
		mastery: presence.hasMasteryTable ? orphanCount('activity_mastery') : 0,
		prefs: presence.hasPrefTable ? orphanCount('child_activity_preferences') : 0,
	};
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
 * #2641 + #2642 / Phase 5 子 3+4 / Phase 6 子 3 #2675 / Phase 7 PR-1:
 * Billing 再設計 Phase 6 の DB 配備 (expand 段階、非破壊・後方互換)。
 *
 * 2 つの責務を 1 関数に集約:
 *
 * 1. `stripe_webhook_events` table 存在チェック → 不在時に CREATE TABLE + 2 index
 *    (`create-tables.ts` SQL_CREATE_TABLES と diff 0 維持、idempotent)
 * 2. 既存 archived レコードの `archived_reason IS NULL` を `'downgrade_user_selected'` で補充
 *    (Phase 5 子 4 §2 原則 4 default 補充、4 location: children / activities /
 *    child_activities / checklist_templates)
 *
 * 実行順序:
 * - `SQL_CREATE_TABLES` (create-tables.ts) より **前** に呼ぶ必要はない
 *   (新規 table + UPDATE のみ、shadow-table recreation 不要、`ALTER TABLE` 不要)
 * - だが `applyLazyStartupMigrations` 内で structural migrations と同時に呼ぶことで
 *   NUC startup での自動実行を保証 (`migrate-local.ts` のみだと production / NUC で実行されない、
 *   #2508 教訓と同型 fail-mode)
 *
 * rollback (子 5 #2665 / Phase 6 子 5 SSOT):
 * - `DROP TABLE stripe_webhook_events` + 既存 archived 補充は data loss 許容
 *   (補充前後の判別不能、Phase 6 子 3 #2675 §5.3 で SSOT 確定)
 *
 * #2509 fix: 1 transaction で囲み、(1)(2) の途中 fail 時に partial state を残さない。
 */
function migrateBillingPhase6(db: Database.Database): void {
	const run = db.transaction(() => {
		// (1) stripe_webhook_events table 配備 (新規 DB / 旧 DB 両対応、idempotent)
		if (!tableExists(db, 'stripe_webhook_events')) {
			db.exec(`
				CREATE TABLE stripe_webhook_events (
					event_id TEXT PRIMARY KEY,
					event_type TEXT NOT NULL,
					processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					handler_result TEXT NOT NULL,
					error_message TEXT,
					retry_count INTEGER NOT NULL DEFAULT 0,
					tenant_id TEXT
				);
				CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
					ON stripe_webhook_events(processed_at);
				CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_result
					ON stripe_webhook_events(event_type, handler_result);
			`);
			console.info('[lazy-migrate #2641 Phase 6] created stripe_webhook_events table + 2 index');
		}

		// (2) 既存 archived レコード の reason 補充 (Phase 5 子 4 §2 原則 4 default 補充)
		const targetTables = [
			'children',
			'activities',
			'child_activities',
			'checklist_templates',
		] as const;
		let totalBackfilled = 0;
		for (const table of targetTables) {
			if (!tableExists(db, table)) continue;
			// is_archived / archived_reason 列が共に存在する table のみ対象
			// (旧 production schema #783 以前は両列が無い、本 migration は #783 以後の DB に対する補充のみ実施)
			if (!hasColumn(db, table, 'is_archived') || !hasColumn(db, table, 'archived_reason')) {
				continue;
			}
			// `is_archived = 1 AND archived_reason IS NULL` を補充。3 経路 (trial / downgrade /
			// dunning) 中で `'downgrade_user_selected'` を default にする理由 (Phase 5 子 4 §2
			// 原則 4): 既存実装で archived を生むのは `downgrade-service.ts` 経由が中心、
			// `trial_expired` 経路は `(parent)/admin/+layout.server.ts:120-145` で reason 必須設定済
			const result = db
				.prepare(
					`UPDATE ${table} SET archived_reason = 'downgrade_user_selected'
					 WHERE is_archived = 1 AND archived_reason IS NULL`,
				)
				.run();
			if (result.changes > 0) {
				totalBackfilled += result.changes;
				console.info(
					`[lazy-migrate #2642 Phase 6] backfilled ${result.changes} rows in ${table} (archived_reason → 'downgrade_user_selected')`,
				);
			}
		}
		if (totalBackfilled === 0) {
			console.info(
				'[lazy-migrate #2642 Phase 6] no archived rows with NULL reason found (idempotent skip)',
			);
		}
	});
	run();
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
		// #3213 (EPIC #3193): auto_challenges DROP。FK switchover 前の単純 table drop。
		migrateDropAutoChallenges(db);
		// #3245: child_challenges auto:weekly に (child_id, start_date) 部分 unique index 復活
		// (dedup → index)。auto_challenges drop 後、child_challenges を触る前に実行。
		migrateChildChallengeAutoWeeklyUnique(db);
		migrateActivityFkSwitchover(db);
		// #2510 / #2513: FK switchover (dim 3) の **後** に data copy (dim 4) を実行。
		// FK target が child_activities になった後でないと remap が整合しないため順序固定。
		migrateActivitiesLegacyDataCopy(db);
		migrateChecklistTemplatesFamilyFlip(db);
		// #2641 + #2642 / Phase 6 子 3 #2675 / Phase 7 PR-1: Billing 再設計 expand 段階
		// (`stripe_webhook_events` table + archived_reason NULL 補充)。
		// 既存 tables に対する純粋追加なので structural migrations の **後** に実行。
		migrateBillingPhase6(db);
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
