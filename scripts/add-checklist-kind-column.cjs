// scripts/add-checklist-kind-column.cjs
// #1168 — checklist_templates テーブルに kind カラムを追加し、既存行を 'routine' で backfill
//
// ADR-0031 準拠: ALTER TABLE ADD COLUMN + 対応する UPDATE WHERE IS NULL を同一 script で実行
//
// 使い方:
//   node scripts/add-checklist-kind-column.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const columns = db.pragma('table_info(checklist_templates)');
const hasColumn = columns.some((c) => c.name === 'kind');

if (hasColumn) {
	console.log('kind カラムは既に存在します');
} else {
	// 既存行は全て legacy = routine として扱う
	// (既存 4 プリセット: morning-routine / evening-routine / after-school / weekend-chores は全てルーティン寄り)
	db.exec("ALTER TABLE checklist_templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'routine'");
	console.log('✓ kind カラムを追加しました (default=routine)');
}

// ADR-0031: NULL 混在行を明示的に backfill (ALTER TABLE ADD COLUMN の DEFAULT は新規行のみ適用される SQLite があるため)
const nullCount = db
	.prepare('SELECT COUNT(*) as c FROM checklist_templates WHERE kind IS NULL')
	.get();
if (nullCount.c > 0) {
	db.exec("UPDATE checklist_templates SET kind = 'routine' WHERE kind IS NULL");
	console.log(`✓ ${nullCount.c} 行の kind=NULL を 'routine' に backfill しました`);
} else {
	console.log('NULL 混在行はありません');
}

db.close();
console.log('完了');
