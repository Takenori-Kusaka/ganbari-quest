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
 */

import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH ?? '/app/data/ganbari-quest.db';
const DRY_RUN = process.env.DRY_RUN === '1';

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
 */
function copyActivitiesForChild(child, insertStmt, referencedStmt, ageFitStmt, mapping) {
	const referencedRows = referencedStmt.all(child.id, child.id, child.id, child.id);
	const ageFitRows = ageFitStmt.all(child.age, child.age);

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
	const insertStmt = db.prepare(`
		INSERT INTO child_activities (
			child_id, name, category_id, icon, base_points, is_visible, daily_limit,
			sort_order, source, name_kana, name_kanji, trigger_hint, is_main_quest,
			created_at, is_archived, archived_reason, source_preset_id, priority
		)
		SELECT
			? AS child_id, a.name, a.category_id, a.icon, a.base_points, a.is_visible, a.daily_limit,
			a.sort_order, a.source, a.name_kana, a.name_kanji, a.trigger_hint,
			COALESCE(a.is_main_quest, 0), a.created_at,
			COALESCE(a.is_archived, 0), a.archived_reason, a.source_preset_id, a.priority
		FROM activities a
		WHERE a.id = ?
	`);

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

	const ageFitStmt = db.prepare(`
		SELECT id FROM activities
		WHERE
			(age_min IS NULL OR age_min <= ?)
			AND (age_max IS NULL OR age_max >= ?)
			AND COALESCE(is_archived, 0) = 0
	`);

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
