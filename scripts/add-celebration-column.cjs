// scripts/add-celebration-column.cjs
// #0119 Phase 2 — children テーブルに active_avatar_celebration カラムを追加
//
// 使い方:
//   node scripts/add-celebration-column.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// カラム存在チェック
const columns = db.pragma('table_info(children)');
const hasColumn = columns.some((c) => c.name === 'active_avatar_celebration');

if (hasColumn) {
	console.log('active_avatar_celebration カラムは既に存在します');
} else {
	db.exec('ALTER TABLE children ADD COLUMN active_avatar_celebration INTEGER');
	console.log('✓ active_avatar_celebration カラムを追加しました');
}

db.close();
console.log('完了');
