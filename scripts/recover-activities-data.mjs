#!/usr/bin/env node
/**
 * NUC 緊急 recovery script — activities data copy 復旧
 *
 * 問題: PR #2487 (#2458-A1) で activity-repo facade を child_activities に flip 後、
 *       既存 production data の copy migration が完全不在。NUC 上で:
 *       - activities: 191 行 (旧 table、現在 read 経路なし)
 *       - child_activities: 0 行 (新 SSOT、空)
 *       - activity_logs: 355 行 (FK は child_activities だが全件 orphan)
 *       - daily_missions: 177 件 orphan / activity_mastery: 40 件 orphan
 *
 * 復旧方針 (RCA Phase B' Option C):
 *   1. 各 child について以下の activity を child_activities に copy:
 *      (a) 既往 activity_logs / daily_missions / activity_mastery
 *          / child_activity_preferences で参照されている activity (history 保全)
 *      (b) age 適合 (age_min ≤ child.age ≤ age_max) かつ未 archive の activity
 *          (UI 一覧表示用)
 *   2. (old activity_id, child_id) → new child_activity_id の mapping を構築
 *   3. activity_logs / daily_missions / activity_mastery / child_activity_preferences
 *      の activity_id を remap
 *   4. orphan = 0 を assert
 *
 * Idempotency: child_activities が空でない場合は skip (既復旧済)。
 *
 * Usage (NUC container 内で実行):
 *   docker exec -i ganbari-quest-app-1 node /app/recover-activities-data.mjs
 *
 * 安全策:
 *   - 全 operation を BEGIN/COMMIT 内で実行
 *   - foreign_keys = OFF (shadow operation 中の FK trip 回避)
 *   - 終了時に foreign_keys = ON に戻す
 *   - orphan assert 失敗時は ROLLBACK
 *
 * ## SSOT 関係 (#2513)
 *
 * 本 script は **NUC container で TS toolchain 無しに単発実行する緊急復旧版**。
 * 同一 logic は startup 自動 migration として
 * `src/lib/server/db/migration/lazy-startup-migrations.ts` の
 * `migrateActivitiesLegacyDataCopy()` に実装されており、そちらが **恒久 SSOT**
 * (新規 NUC / dev / CI でも startup 時に自動適用)。
 *
 * 両者は runtime が異なり (standalone `node` vs SvelteKit build) import による
 * code 共有が不可能なため、**SQL logic を 2 箇所で維持** する。どちらかを変更する
 * 際は他方も同期させること。挙動は同一に保つ:
 *   - child_activities INSERT は source/target 双方に存在する column のみ対象
 *     (古い schema で column を欠く DB でも `no such column` で fail しない)
 *   - referenced ∪ age 適合 の和集合を copy、age 列が無い旧 schema では referenced のみ
 *   - 4 table remap 後 orphan = 0 を assert
 *
 * 通常運用では本 script の手動実行は不要 (startup migration が自動修復)。本 script は
 * DynamoDB 等別 backend で同型問題が起きた際の参照実装 / NUC での明示再実行用に残す。
 * 詳細: docs/runbooks/activities-data-recovery.md / docs/design/08-データベース設計書.md §8.6。
 */

import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH ?? '/app/data/ganbari-quest.db';
const DRY_RUN = process.env.DRY_RUN === '1';

/** table が存在するか */
function tableExists(db, name) {
	return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

/** table に column が存在するか */
function hasColumn(db, table, column) {
	if (!tableExists(db, table)) return false;
	return db
		.prepare(`PRAGMA table_info(${table})`)
		.all()
		.some((c) => c.name === column);
}

/**
 * source (`activities`) と target (`child_activities`) の双方に存在する copy 対象
 * column のみ返す (片方にしか無い列を SELECT/INSERT すると `no such column` で fail)。
 * lazy-startup-migrations.ts の detectCopyableActivityColumns と同一ロジック (#2513 SSOT 同期)。
 */
function detectCopyableActivityColumns(db) {
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

const ORPHAN_QUERIES = {
	logs: `SELECT COUNT(*) AS c FROM activity_logs al
		 WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = al.activity_id)`,
	missions: `SELECT COUNT(*) AS c FROM daily_missions dm
		 WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = dm.activity_id)`,
	mastery: `SELECT COUNT(*) AS c FROM activity_mastery am
		 WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = am.activity_id)`,
	prefs: `SELECT COUNT(*) AS c FROM child_activity_preferences cp
		 WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = cp.activity_id)`,
};

function getOrphanCounts(db) {
	return {
		logs: db.prepare(ORPHAN_QUERIES.logs).get().c,
		missions: db.prepare(ORPHAN_QUERIES.missions).get().c,
		mastery: db.prepare(ORPHAN_QUERIES.mastery).get().c,
		prefs: db.prepare(ORPHAN_QUERIES.prefs).get().c,
	};
}

/**
 * 1 つの table に対し activity_id remap を適用。
 * @returns { remapped, total }
 */
function remapTable(db, tableName, mapping) {
	const update = db.prepare(`UPDATE ${tableName} SET activity_id = ? WHERE id = ?`);
	const rows = db.prepare(`SELECT id, child_id, activity_id FROM ${tableName}`).all();
	let remapped = 0;
	for (const row of rows) {
		const newId = mapping.get(`${row.child_id}:${row.activity_id}`);
		if (newId !== undefined) {
			update.run(newId, row.id);
			remapped++;
		}
	}
	return { remapped, total: rows.length };
}

/**
 * 1 child について copy 対象 activity を child_activities に INSERT し、mapping に登録する。
 * ageFitStmt は age 列が無い旧 schema では null (referenced のみで copy)。
 */
function copyActivitiesForChild(child, insertStmt, referencedStmt, ageFitStmt, mapping) {
	const referencedRows = referencedStmt.all(child.id, child.id, child.id, child.id);
	const ageFitRows = ageFitStmt && child.age != null ? ageFitStmt.all(child.age, child.age) : [];

	const activityIdSet = new Set();
	for (const r of referencedRows) activityIdSet.add(r.activity_id);
	for (const r of ageFitRows) activityIdSet.add(r.id);

	console.log(
		`[recover] child id=${child.id} (${child.nickname}, age ${child.age}): ` +
			`referenced=${referencedRows.length} age_fit=${ageFitRows.length} union=${activityIdSet.size}`,
	);

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
 * Transaction 本体。child_activities INSERT → 4 table の FK remap → orphan assert。
 * 失敗時は throw で ROLLBACK。
 */
function runRecoveryTransaction(db, children) {
	// source/target 双方に存在する column のみ INSERT (古い schema の column 欠落に耐える)
	const copyableCols = detectCopyableActivityColumns(db);
	const insertCols = ['child_id', ...copyableCols];
	const selectCols = copyableCols.map((c) => `a.${c}`).join(', ');
	const insertStmt = db.prepare(
		`INSERT INTO child_activities (${insertCols.join(', ')})
		 SELECT ?${selectCols ? `, ${selectCols}` : ''} FROM activities a WHERE a.id = ?`,
	);

	const referencedStmt = db.prepare(`
		SELECT DISTINCT activity_id FROM (
			SELECT activity_id FROM activity_logs WHERE child_id = ?
			UNION
			SELECT activity_id FROM daily_missions WHERE child_id = ?
			UNION
			SELECT activity_id FROM activity_mastery WHERE child_id = ?
			UNION
			SELECT activity_id FROM child_activity_preferences WHERE child_id = ?
		)
	`);

	// age 列が無い旧 schema では age 適合 copy を skip (referenced のみ)。
	const hasAge =
		hasColumn(db, 'children', 'age') &&
		hasColumn(db, 'activities', 'age_min') &&
		hasColumn(db, 'activities', 'age_max');
	const ageFitStmt = hasAge
		? db.prepare(`
			SELECT id FROM activities
			WHERE
				(age_min IS NULL OR age_min <= ?)
				AND (age_max IS NULL OR age_max >= ?)
				AND COALESCE(is_archived, 0) = 0
		`)
		: null;

	const mapping = new Map();
	let totalCopied = 0;
	for (const child of children) {
		totalCopied += copyActivitiesForChild(child, insertStmt, referencedStmt, ageFitStmt, mapping);
	}
	console.log(
		`[recover] inserted ${totalCopied} child_activities rows (mapping size: ${mapping.size})`,
	);

	for (const tableName of [
		'activity_logs',
		'daily_missions',
		'activity_mastery',
		'child_activity_preferences',
	]) {
		const { remapped, total } = remapTable(db, tableName, mapping);
		console.log(`[recover] ${tableName} remapped: ${remapped} / ${total}`);
	}

	const after = getOrphanCounts(db);
	console.log(
		`[recover] AFTER: orphan_logs=${after.logs} orphan_missions=${after.missions} ` +
			`orphan_mastery=${after.mastery} orphan_prefs=${after.prefs}`,
	);

	if (after.logs > 0 || after.missions > 0 || after.mastery > 0 || after.prefs > 0) {
		throw new Error(
			`[recover] ORPHAN DETECTED after migration — ROLLBACK. ` +
				`logs=${after.logs} missions=${after.missions} mastery=${after.mastery} prefs=${after.prefs}`,
		);
	}
}

function main() {
	console.log(`[recover-activities-data] DB: ${DB_PATH} ${DRY_RUN ? '(DRY_RUN)' : ''}`);

	const db = new Database(DB_PATH);
	db.pragma('foreign_keys = OFF');

	try {
		// --- Guard: 既復旧済なら skip ---
		const caCount = db.prepare('SELECT COUNT(*) AS c FROM child_activities').get().c;
		if (caCount > 0) {
			console.log(
				`[recover] child_activities already has ${caCount} rows. SKIP (already recovered).`,
			);
			return;
		}

		const activitiesCount = db.prepare('SELECT COUNT(*) AS c FROM activities').get().c;
		if (activitiesCount === 0) {
			console.log('[recover] activities table empty. Nothing to recover. SKIP.');
			return;
		}

		// --- 統計 ---
		const children = db
			.prepare('SELECT id, nickname, age FROM children WHERE COALESCE(is_archived, 0) = 0')
			.all();
		console.log(`[recover] children: ${children.length}`);
		for (const c of children) {
			console.log(`  - id=${c.id} nickname=${c.nickname} age=${c.age}`);
		}

		const before = getOrphanCounts(db);
		console.log(
			`[recover] BEFORE: orphan_logs=${before.logs} orphan_missions=${before.missions} ` +
				`orphan_mastery=${before.mastery} orphan_prefs=${before.prefs}`,
		);

		if (DRY_RUN) {
			console.log('[recover] DRY_RUN — exiting without changes');
			return;
		}

		// --- transaction (失敗時は自動 ROLLBACK) ---
		const tx = db.transaction(() => runRecoveryTransaction(db, children));
		tx();
		console.log('[recover] SUCCESS — transaction committed, orphan = 0 across 4 tables');

		// --- 最終 state print ---
		const finalCA = db.prepare('SELECT COUNT(*) AS c FROM child_activities').get().c;
		const finalCAPerChild = db
			.prepare('SELECT child_id, COUNT(*) AS c FROM child_activities GROUP BY child_id')
			.all();
		console.log(`[recover] FINAL child_activities: ${finalCA} total`);
		for (const r of finalCAPerChild) {
			console.log(`  - child_id=${r.child_id}: ${r.c} activities`);
		}
	} finally {
		db.pragma('foreign_keys = ON');
		db.close();
	}
}

main();
