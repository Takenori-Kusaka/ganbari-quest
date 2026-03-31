// scripts/migration-0257-cleanup.cjs
// #0257 廃止機能の完全除去 — DB マイグレーション
//
// 削除対象:
//   - birthday_reviews テーブル
//   - avatar_items, child_avatar_items テーブル
//   - career_fields, career_plans, career_plan_history テーブル
//   - skill_nodes, child_skill_nodes, skill_points テーブル
//   - children テーブルから activeAvatar* 5カラム
//
// 使い方:
//   node scripts/migration-0257-cleanup.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db
//
// 注意:
//   - point_ledger の廃止機能関連レコードは残置（履歴として保全）
//   - 実行前にコンテナを停止すること（WAL 破損防止）

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ============================================================
// Step 1: テーブル削除
// ============================================================

const tablesToDrop = [
	'birthday_reviews',
	'avatar_items',
	'child_avatar_items',
	'career_fields',
	'career_plans',
	'career_plan_history',
	'skill_nodes',
	'child_skill_nodes',
	'skill_points',
];

for (const table of tablesToDrop) {
	const exists = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
		.get(table);
	if (exists) {
		db.exec(`DROP TABLE ${table}`);
		console.log(`  DROP TABLE ${table} ✓`);
	} else {
		console.log(`  ${table} — 存在しない（スキップ）`);
	}
}

// ============================================================
// Step 2: children テーブルから activeAvatar* カラム削除
// ============================================================

const avatarColumns = [
	'active_avatar_bg',
	'active_avatar_frame',
	'active_avatar_effect',
	'active_avatar_sound',
	'active_avatar_celebration',
];

// SQLite 3.35.0+ は ALTER TABLE DROP COLUMN をサポート
const sqliteVersion = db.prepare('SELECT sqlite_version() as v').get();
console.log(`\nSQLite version: ${sqliteVersion.v}`);

for (const col of avatarColumns) {
	try {
		// カラムが存在するか確認
		const info = db.prepare(`PRAGMA table_info(children)`).all();
		const colExists = info.some((c) => c.name === col);
		if (colExists) {
			db.exec(`ALTER TABLE children DROP COLUMN ${col}`);
			console.log(`  DROP COLUMN children.${col} ✓`);
		} else {
			console.log(`  children.${col} — 存在しない（スキップ）`);
		}
	} catch (err) {
		console.error(`  children.${col} — エラー: ${err.message}`);
	}
}

// ============================================================
// Step 3: 確認
// ============================================================

console.log('\n=== 残存テーブル ===');
const remainingTables = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
	.all();
for (const t of remainingTables) {
	console.log(`  ${t.name}`);
}

console.log('\n=== children カラム ===');
const childrenCols = db.prepare('PRAGMA table_info(children)').all();
for (const c of childrenCols) {
	console.log(`  ${c.name} (${c.type})`);
}

db.close();
console.log('\n✓ マイグレーション完了');
