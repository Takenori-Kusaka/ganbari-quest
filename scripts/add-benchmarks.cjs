// scripts/add-benchmarks.cjs
// #0047 市場比較機能 — ベンチマークデータ拡充（3〜12歳）
//
// 使い方:
//   node scripts/add-benchmarks.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const benchmarks = [
	// age 3
	{ age: 3, category_id: 1, mean: 15.0, std_dev: 5.0, source: '推定値' },
	{ age: 3, category_id: 2, mean: 10.0, std_dev: 4.0, source: '推定値' },
	{ age: 3, category_id: 3, mean: 20.0, std_dev: 5.0, source: '推定値' },
	{ age: 3, category_id: 4, mean: 12.0, std_dev: 5.0, source: '推定値' },
	{ age: 3, category_id: 5, mean: 12.0, std_dev: 4.0, source: '推定値' },
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
console.log(`  ベンチマーク: ${inserted}件追加 (既存スキップ: ${benchmarks.length - inserted}件)`);

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('Done.');
