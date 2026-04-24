// scripts/add-source-preset-id.cjs
// #1254 G1 — activities / special_rewards / checklist_templates に source_preset_id カラムを追加
//
// 既定値 NULL で追加する。NULL はマーケットプレイスプリセット由来でない既存行を表す
// （業務的意味あり）。ADR-0031 の backfill 必須ルールは「業務的意味で NULL を使う場合を除く」
// に該当するため UPDATE は行わない。
//
// 使い方:
//   node scripts/add-source-preset-id.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const tables = ['activities', 'special_rewards', 'checklist_templates'];

for (const table of tables) {
	const columns = db.pragma(`table_info(${table})`);
	const hasColumn = columns.some((c) => c.name === 'source_preset_id');

	if (hasColumn) {
		console.log(`${table}.source_preset_id は既に存在します`);
		continue;
	}

	db.exec(`ALTER TABLE ${table} ADD COLUMN source_preset_id TEXT`);
	console.log(`✓ ${table}.source_preset_id カラムを追加しました (nullable, default=NULL)`);
}

db.close();
console.log('完了');
