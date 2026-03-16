// scripts/add-benchmarks.cjs
// #0047 市場比較機能 — テーブルスキーマ移行 + ベンチマークデータ拡充（3〜12歳）
//
// 使い方:
//   node scripts/add-benchmarks.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db
//
// 本番DBの旧スキーマ (category TEXT) → 新スキーマ (category_id INTEGER) へ移行し、
// 3〜12歳のベンチマークデータを投入する。

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// カテゴリ名 → ID マッピング
const CATEGORY_MAP = {
	'うんどう': 1,
	'べんきょう': 2,
	'せいかつ': 3,
	'こうりゅう': 4,
	'そうぞう': 5,
};

// Step 1: スキーマ移行（category TEXT → category_id INTEGER）
const columns = db.pragma('table_info(market_benchmarks)');
const hasOldSchema = columns.some((c) => c.name === 'category' && c.type === 'TEXT');
const hasNewSchema = columns.some((c) => c.name === 'category_id');

if (hasOldSchema && !hasNewSchema) {
	console.log('スキーマ移行: category TEXT → category_id INTEGER');

	// 既存データを取得
	const oldRows = db.prepare('SELECT * FROM market_benchmarks').all();
	console.log(`  既存データ: ${oldRows.length}件`);

	db.exec('DROP TABLE market_benchmarks');
	db.exec(`
		CREATE TABLE market_benchmarks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			age INTEGER NOT NULL,
			category_id INTEGER NOT NULL,
			mean REAL NOT NULL,
			std_dev REAL NOT NULL,
			source TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`);
	db.exec('CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks (age, category_id)');

	// 旧データを新スキーマで再投入
	const insertMigrated = db.prepare(
		'INSERT INTO market_benchmarks (age, category_id, mean, std_dev, source) VALUES (?, ?, ?, ?, ?)',
	);
	let migrated = 0;
	for (const row of oldRows) {
		const catId = CATEGORY_MAP[row.category];
		if (catId) {
			insertMigrated.run(row.age, catId, row.mean, row.std_dev, row.source);
			migrated++;
		} else {
			console.log(`  スキップ（不明カテゴリ）: ${row.category}`);
		}
	}
	console.log(`  移行完了: ${migrated}件`);

	// VACUUM でページ整合性を確保
	db.exec('VACUUM');
	console.log('  VACUUM完了');
} else if (hasNewSchema) {
	console.log('スキーマ移行: 不要（新スキーマ済み）');
} else {
	console.log('警告: 予期しないスキーマ構造です');
	db.close();
	process.exit(1);
}

// Step 2: ベンチマークデータ拡充
const benchmarks = [
	// age 3
	{ age: 3, category_id: 1, mean: 15.0, std_dev: 5.0, source: '推定値' },
	{ age: 3, category_id: 2, mean: 10.0, std_dev: 4.0, source: '推定値' },
	{ age: 3, category_id: 3, mean: 20.0, std_dev: 5.0, source: '推定値' },
	{ age: 3, category_id: 4, mean: 12.0, std_dev: 5.0, source: '推定値' },
	{ age: 3, category_id: 5, mean: 12.0, std_dev: 4.0, source: '推定値' },
	// age 4 (既存データ更新)
	{ age: 4, category_id: 1, mean: 30.0, std_dev: 10.0, source: '推定値' },
	{ age: 4, category_id: 2, mean: 20.0, std_dev: 8.0, source: '推定値' },
	{ age: 4, category_id: 3, mean: 35.0, std_dev: 8.0, source: '推定値' },
	{ age: 4, category_id: 4, mean: 25.0, std_dev: 10.0, source: '推定値' },
	{ age: 4, category_id: 5, mean: 25.0, std_dev: 9.0, source: '推定値' },
	// age 5
	{ age: 5, category_id: 1, mean: 50.0, std_dev: 15.0, source: '推定値' },
	{ age: 5, category_id: 2, mean: 35.0, std_dev: 12.0, source: '推定値' },
	{ age: 5, category_id: 3, mean: 55.0, std_dev: 12.0, source: '推定値' },
	{ age: 5, category_id: 4, mean: 40.0, std_dev: 14.0, source: '推定値' },
	{ age: 5, category_id: 5, mean: 40.0, std_dev: 13.0, source: '推定値' },
	// age 6
	{ age: 6, category_id: 1, mean: 80.0, std_dev: 25.0, source: '推定値' },
	{ age: 6, category_id: 2, mean: 60.0, std_dev: 20.0, source: '推定値' },
	{ age: 6, category_id: 3, mean: 90.0, std_dev: 20.0, source: '推定値' },
	{ age: 6, category_id: 4, mean: 65.0, std_dev: 22.0, source: '推定値' },
	{ age: 6, category_id: 5, mean: 65.0, std_dev: 20.0, source: '推定値' },
	// age 7
	{ age: 7, category_id: 1, mean: 120.0, std_dev: 35.0, source: '推定値' },
	{ age: 7, category_id: 2, mean: 90.0, std_dev: 28.0, source: '推定値' },
	{ age: 7, category_id: 3, mean: 130.0, std_dev: 28.0, source: '推定値' },
	{ age: 7, category_id: 4, mean: 95.0, std_dev: 30.0, source: '推定値' },
	{ age: 7, category_id: 5, mean: 95.0, std_dev: 28.0, source: '推定値' },
	// age 8
	{ age: 8, category_id: 1, mean: 160.0, std_dev: 45.0, source: '推定値' },
	{ age: 8, category_id: 2, mean: 130.0, std_dev: 38.0, source: '推定値' },
	{ age: 8, category_id: 3, mean: 180.0, std_dev: 38.0, source: '推定値' },
	{ age: 8, category_id: 4, mean: 130.0, std_dev: 40.0, source: '推定値' },
	{ age: 8, category_id: 5, mean: 130.0, std_dev: 35.0, source: '推定値' },
	// age 9
	{ age: 9, category_id: 1, mean: 220.0, std_dev: 60.0, source: '推定値' },
	{ age: 9, category_id: 2, mean: 180.0, std_dev: 50.0, source: '推定値' },
	{ age: 9, category_id: 3, mean: 250.0, std_dev: 50.0, source: '推定値' },
	{ age: 9, category_id: 4, mean: 180.0, std_dev: 55.0, source: '推定値' },
	{ age: 9, category_id: 5, mean: 180.0, std_dev: 48.0, source: '推定値' },
	// age 10
	{ age: 10, category_id: 1, mean: 280.0, std_dev: 75.0, source: '推定値' },
	{ age: 10, category_id: 2, mean: 240.0, std_dev: 62.0, source: '推定値' },
	{ age: 10, category_id: 3, mean: 320.0, std_dev: 60.0, source: '推定値' },
	{ age: 10, category_id: 4, mean: 230.0, std_dev: 65.0, source: '推定値' },
	{ age: 10, category_id: 5, mean: 230.0, std_dev: 58.0, source: '推定値' },
	// age 11
	{ age: 11, category_id: 1, mean: 340.0, std_dev: 85.0, source: '推定値' },
	{ age: 11, category_id: 2, mean: 300.0, std_dev: 75.0, source: '推定値' },
	{ age: 11, category_id: 3, mean: 400.0, std_dev: 70.0, source: '推定値' },
	{ age: 11, category_id: 4, mean: 280.0, std_dev: 75.0, source: '推定値' },
	{ age: 11, category_id: 5, mean: 280.0, std_dev: 68.0, source: '推定値' },
	// age 12
	{ age: 12, category_id: 1, mean: 400.0, std_dev: 95.0, source: '推定値' },
	{ age: 12, category_id: 2, mean: 360.0, std_dev: 85.0, source: '推定値' },
	{ age: 12, category_id: 3, mean: 480.0, std_dev: 80.0, source: '推定値' },
	{ age: 12, category_id: 4, mean: 340.0, std_dev: 85.0, source: '推定値' },
	{ age: 12, category_id: 5, mean: 340.0, std_dev: 78.0, source: '推定値' },
];

const check = db.prepare(
	'SELECT id FROM market_benchmarks WHERE age = ? AND category_id = ?',
);
const insert = db.prepare(
	'INSERT INTO market_benchmarks (age, category_id, mean, std_dev, source) VALUES (?, ?, ?, ?, ?)',
);

let inserted = 0;
const insertAll = db.transaction(() => {
	for (const b of benchmarks) {
		const existing = check.get(b.age, b.category_id);
		if (!existing) {
			insert.run(b.age, b.category_id, b.mean, b.std_dev, b.source);
			inserted++;
		}
	}
});

insertAll();
console.log(`ベンチマーク: ${inserted}件追加 (既存スキップ: ${benchmarks.length - inserted}件)`);

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('Done.');
