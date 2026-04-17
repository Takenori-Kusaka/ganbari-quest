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
	うんどう: 1,
	べんきょう: 2,
	せいかつ: 3,
	こうりゅう: 4,
	そうぞう: 5,
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
	db.exec(
		'CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks (age, category_id)',
	);

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

// Step 2: ベンチマークデータ拡充（発達段階モデル推定）
// 根拠:
// - せいかつ(3): 日常習慣は幼児期から蓄積が早く全年齢で最高値
// - うんどう(1): 粗大運動→巧緻運動と着実に発達（文科省体力テスト参考）
// - べんきょう(2): 就学前は低め、6歳以降に加速（学習指導要領準拠）
// - こうりゅう(4): 幼児期は基礎的、学童期にピアグループ形成で加速
// - そうぞう(5): 幼児期に豊かな想像力、学童期は型の習得期で緩やか
const S = '発達段階モデル推定';
const benchmarks = [
	// age 3 — 基本的生活習慣の形成期
	{ age: 3, category_id: 1, mean: 16.0, std_dev: 5.0, source: S },
	{ age: 3, category_id: 2, mean: 8.0, std_dev: 3.0, source: S },
	{ age: 3, category_id: 3, mean: 22.0, std_dev: 6.0, source: S },
	{ age: 3, category_id: 4, mean: 12.0, std_dev: 4.0, source: S },
	{ age: 3, category_id: 5, mean: 14.0, std_dev: 4.5, source: S },
	// age 4 — 運動機能の発達・社会性の芽生え
	{ age: 4, category_id: 1, mean: 30.0, std_dev: 9.0, source: S },
	{ age: 4, category_id: 2, mean: 18.0, std_dev: 6.0, source: S },
	{ age: 4, category_id: 3, mean: 38.0, std_dev: 10.0, source: S },
	{ age: 4, category_id: 4, mean: 24.0, std_dev: 8.0, source: S },
	{ age: 4, category_id: 5, mean: 28.0, std_dev: 8.0, source: S },
	// age 5 — 就学準備期・協調性の発達
	{ age: 5, category_id: 1, mean: 52.0, std_dev: 15.0, source: S },
	{ age: 5, category_id: 2, mean: 32.0, std_dev: 10.0, source: S },
	{ age: 5, category_id: 3, mean: 60.0, std_dev: 16.0, source: S },
	{ age: 5, category_id: 4, mean: 40.0, std_dev: 12.0, source: S },
	{ age: 5, category_id: 5, mean: 42.0, std_dev: 12.0, source: S },
	// age 6 — 小学校入学・学習活動の開始
	{ age: 6, category_id: 1, mean: 85.0, std_dev: 25.0, source: S },
	{ age: 6, category_id: 2, mean: 65.0, std_dev: 20.0, source: S },
	{ age: 6, category_id: 3, mean: 95.0, std_dev: 25.0, source: S },
	{ age: 6, category_id: 4, mean: 62.0, std_dev: 18.0, source: S },
	{ age: 6, category_id: 5, mean: 58.0, std_dev: 17.0, source: S },
	// age 7 — 学習習慣の定着・友人関係の深化
	{ age: 7, category_id: 1, mean: 122.0, std_dev: 36.0, source: S },
	{ age: 7, category_id: 2, mean: 105.0, std_dev: 32.0, source: S },
	{ age: 7, category_id: 3, mean: 138.0, std_dev: 36.0, source: S },
	{ age: 7, category_id: 4, mean: 95.0, std_dev: 28.0, source: S },
	{ age: 7, category_id: 5, mean: 82.0, std_dev: 24.0, source: S },
	// age 8 — 論理的思考の発達・ギャングエイジ
	{ age: 8, category_id: 1, mean: 168.0, std_dev: 50.0, source: S },
	{ age: 8, category_id: 2, mean: 152.0, std_dev: 46.0, source: S },
	{ age: 8, category_id: 3, mean: 188.0, std_dev: 48.0, source: S },
	{ age: 8, category_id: 4, mean: 140.0, std_dev: 42.0, source: S },
	{ age: 8, category_id: 5, mean: 112.0, std_dev: 33.0, source: S },
	// age 9 — 抽象的思考・集団活動の充実
	{ age: 9, category_id: 1, mean: 222.0, std_dev: 66.0, source: S },
	{ age: 9, category_id: 2, mean: 205.0, std_dev: 62.0, source: S },
	{ age: 9, category_id: 3, mean: 248.0, std_dev: 62.0, source: S },
	{ age: 9, category_id: 4, mean: 192.0, std_dev: 58.0, source: S },
	{ age: 9, category_id: 5, mean: 148.0, std_dev: 44.0, source: S },
	// age 10 — 自律性の確立・高次思考力
	{ age: 10, category_id: 1, mean: 282.0, std_dev: 85.0, source: S },
	{ age: 10, category_id: 2, mean: 265.0, std_dev: 80.0, source: S },
	{ age: 10, category_id: 3, mean: 315.0, std_dev: 78.0, source: S },
	{ age: 10, category_id: 4, mean: 248.0, std_dev: 75.0, source: S },
	{ age: 10, category_id: 5, mean: 192.0, std_dev: 58.0, source: S },
	// age 11 — 思春期前期・自己表現の発達
	{ age: 11, category_id: 1, mean: 348.0, std_dev: 105.0, source: S },
	{ age: 11, category_id: 2, mean: 330.0, std_dev: 100.0, source: S },
	{ age: 11, category_id: 3, mean: 390.0, std_dev: 95.0, source: S },
	{ age: 11, category_id: 4, mean: 308.0, std_dev: 92.0, source: S },
	{ age: 11, category_id: 5, mean: 245.0, std_dev: 74.0, source: S },
	// age 12 — 思春期・自立と協働
	{ age: 12, category_id: 1, mean: 418.0, std_dev: 125.0, source: S },
	{ age: 12, category_id: 2, mean: 400.0, std_dev: 120.0, source: S },
	{ age: 12, category_id: 3, mean: 470.0, std_dev: 115.0, source: S },
	{ age: 12, category_id: 4, mean: 372.0, std_dev: 112.0, source: S },
	{ age: 12, category_id: 5, mean: 302.0, std_dev: 90.0, source: S },
];

const check = db.prepare(
	'SELECT id, mean, std_dev, source FROM market_benchmarks WHERE age = ? AND category_id = ?',
);
const insert = db.prepare(
	'INSERT INTO market_benchmarks (age, category_id, mean, std_dev, source) VALUES (?, ?, ?, ?, ?)',
);
const update = db.prepare(
	'UPDATE market_benchmarks SET mean = ?, std_dev = ?, source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
);

let inserted = 0;
let updated = 0;
let skipped = 0;
const upsertAll = db.transaction(() => {
	for (const b of benchmarks) {
		const existing = check.get(b.age, b.category_id);
		if (!existing) {
			insert.run(b.age, b.category_id, b.mean, b.std_dev, b.source);
			inserted++;
		} else if (
			existing.mean !== b.mean ||
			existing.std_dev !== b.std_dev ||
			existing.source !== b.source
		) {
			update.run(b.mean, b.std_dev, b.source, existing.id);
			updated++;
		} else {
			skipped++;
		}
	}
});

upsertAll();
console.log(`ベンチマーク: ${inserted}件追加, ${updated}件更新, ${skipped}件スキップ（変更なし）`);

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('Done.');
