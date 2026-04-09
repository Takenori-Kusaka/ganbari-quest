#!/usr/bin/env node
/**
 * #571 旧 ui_mode コード正規化マイグレーション
 *
 * 症状:
 *   ローカル NUC で /kinder/home が 404 になる。
 *
 * 原因:
 *   sqlite/child-repo.ts の旧 writeBackChildSv() が _sv フィールドだけを
 *   更新し、transformer (kinder→preschool 等) を適用していなかった。
 *   そのため `ui_mode='kinder'`, `_sv=3` という嘘マイグレーション済み
 *   状態の行が DB に残っている。
 *
 * 本スクリプト:
 *   children テーブルの ui_mode を以下のマッピングで正規化する:
 *     kinder → preschool
 *     lower  → elementary
 *     upper  → junior
 *     teen   → senior
 *
 * 実行方法（NUC）:
 *   ssh kusaka-server@192.168.68.79 "cd C:\\Docker\\ganbari-quest && \
 *     docker compose stop app && \
 *     node scripts/normalize-legacy-ui-modes.cjs data/ganbari-quest.db && \
 *     docker compose up -d"
 *
 * 実行方法（ローカル）:
 *   node scripts/normalize-legacy-ui-modes.cjs ganbari.db
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.argv[2] || process.env.DB_PATH || path.join(__dirname, '..', 'ganbari.db');
console.log(`[normalize-legacy-ui-modes] DB: ${DB_PATH}`);

const LEGACY_MAP = {
	kinder: 'preschool',
	lower: 'elementary',
	upper: 'junior',
	teen: 'senior',
};

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

try {
	// 確認: children テーブルの存在
	const hasChildren = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='children'")
		.get();
	if (!hasChildren) {
		console.error('❌ children テーブルが存在しません');
		process.exit(1);
	}

	// 影響行の確認
	const before = db
		.prepare(
			"SELECT id, nickname, ui_mode FROM children WHERE ui_mode IN ('kinder', 'lower', 'upper', 'teen')",
		)
		.all();

	if (before.length === 0) {
		console.log('✅ 修正対象なし — すべての ui_mode は新コードです');
		db.close();
		process.exit(0);
	}

	console.log(`\n📋 修正対象 ${before.length} 件:`);
	for (const row of before) {
		const newMode = LEGACY_MAP[row.ui_mode] ?? row.ui_mode;
		console.log(`  id=${row.id} ${row.nickname}: ${row.ui_mode} → ${newMode}`);
	}

	db.exec('BEGIN TRANSACTION');

	let total = 0;
	for (const [oldMode, newMode] of Object.entries(LEGACY_MAP)) {
		const result = db
			.prepare('UPDATE children SET ui_mode = ? WHERE ui_mode = ?')
			.run(newMode, oldMode);
		if (result.changes > 0) {
			console.log(`  ✓ ${oldMode} → ${newMode}: ${result.changes} 行更新`);
			total += result.changes;
		}
	}

	db.exec('COMMIT');
	console.log(`\n✅ 完了: ${total} 行を正規化しました`);

	// WAL checkpoint
	db.pragma('wal_checkpoint(TRUNCATE)');
	console.log('  ✓ WAL checkpoint 完了');

	// 検証
	const after = db
		.prepare(
			"SELECT COUNT(*) as cnt FROM children WHERE ui_mode IN ('kinder', 'lower', 'upper', 'teen')",
		)
		.get();
	if (after.cnt > 0) {
		console.error(`⚠ ${after.cnt} 件の旧コードが残っています`);
		process.exit(1);
	}
	console.log('  ✓ 旧コードゼロ確認');
} catch (err) {
	try {
		db.exec('ROLLBACK');
	} catch {}
	console.error('❌ マイグレーション失敗:', err);
	process.exit(1);
} finally {
	db.close();
}
