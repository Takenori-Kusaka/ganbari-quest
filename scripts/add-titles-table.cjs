// scripts/add-titles-table.cjs
// #0085 称号コレクション — テーブル作成 + 初期データ投入
//
// 使い方:
//   node scripts/add-titles-table.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 1. titles テーブル作成
const hasTitlesTable = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='titles'")
	.get();

if (!hasTitlesTable) {
	db.exec(`
		CREATE TABLE titles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			description TEXT,
			icon TEXT NOT NULL,
			condition_type TEXT NOT NULL,
			condition_value INTEGER NOT NULL,
			condition_extra TEXT,
			rarity TEXT NOT NULL DEFAULT 'common',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`);
	console.log('  CREATE: titles table');
} else {
	console.log('  SKIP: titles table already exists');
}

// 2. child_titles テーブル作成
const hasChildTitlesTable = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='child_titles'")
	.get();

if (!hasChildTitlesTable) {
	db.exec(`
		CREATE TABLE child_titles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			title_id INTEGER NOT NULL REFERENCES titles(id),
			unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX idx_child_titles_unique ON child_titles(child_id, title_id);
	`);
	console.log('  CREATE: child_titles table');
} else {
	console.log('  SKIP: child_titles table already exists');
}

// 3. children テーブルに active_title_id カラム追加
const childrenCols = db.pragma('table_info(children)');
const hasActiveTitleId = childrenCols.some((c) => c.name === 'active_title_id');

if (!hasActiveTitleId) {
	db.exec('ALTER TABLE children ADD COLUMN active_title_id INTEGER');
	console.log('  ALTER: children + active_title_id');
} else {
	console.log('  SKIP: active_title_id already exists');
}

// 4. 初期称号データ投入
const existingTitles = db.prepare('SELECT COUNT(*) as cnt FROM titles').get();

if (existingTitles.cnt === 0) {
	const titlesData = [
		{
			code: 'undou_master',
			name: 'うんどうマスター',
			description: 'うんどうのへんさちが65いじょう！',
			icon: '🏋️',
			conditionType: 'category_deviation',
			conditionValue: 65,
			conditionExtra: JSON.stringify({ categoryId: 1 }),
			rarity: 'rare',
			sortOrder: 1,
		},
		{
			code: 'benkyou_tensai',
			name: 'べんきょうの天才',
			description: 'べんきょうのへんさちが65いじょう！',
			icon: '🧠',
			conditionType: 'category_deviation',
			conditionValue: 65,
			conditionExtra: JSON.stringify({ categoryId: 2 }),
			rarity: 'rare',
			sortOrder: 2,
		},
		{
			code: 'seikatsu_tatsujin',
			name: 'せいかつの達人',
			description: 'せいかつのへんさちが65いじょう！',
			icon: '🏡',
			conditionType: 'category_deviation',
			conditionValue: 65,
			conditionExtra: JSON.stringify({ categoryId: 3 }),
			rarity: 'rare',
			sortOrder: 3,
		},
		{
			code: 'kouryuu_ou',
			name: 'こうりゅうの王',
			description: 'こうりゅうのへんさちが65いじょう！',
			icon: '👑',
			conditionType: 'category_deviation',
			conditionValue: 65,
			conditionExtra: JSON.stringify({ categoryId: 4 }),
			rarity: 'rare',
			sortOrder: 4,
		},
		{
			code: 'souzou_mahou',
			name: 'そうぞうの魔法使い',
			description: 'そうぞうのへんさちが65いじょう！',
			icon: '🪄',
			conditionType: 'category_deviation',
			conditionValue: 65,
			conditionExtra: JSON.stringify({ categoryId: 5 }),
			rarity: 'rare',
			sortOrder: 5,
		},
		{
			code: 'renzoku_oni',
			name: 'れんぞくの鬼',
			description: '30にちれんぞくでかつどうをきろくした！',
			icon: '👹',
			conditionType: 'streak_days',
			conditionValue: 30,
			conditionExtra: null,
			rarity: 'epic',
			sortOrder: 6,
		},
		{
			code: 'all_rounder',
			name: 'オールラウンダー',
			description: 'すべてのカテゴリのへんさちが55いじょう！',
			icon: '🌟',
			conditionType: 'all_categories_deviation',
			conditionValue: 55,
			conditionExtra: null,
			rarity: 'legendary',
			sortOrder: 7,
		},
		{
			code: 'kami_level',
			name: 'かみさまのしもべ',
			description: 'レベル10にとうたつした！',
			icon: '✨',
			conditionType: 'level_reach',
			conditionValue: 10,
			conditionExtra: null,
			rarity: 'legendary',
			sortOrder: 8,
		},
	];

	const insert = db.prepare(`
		INSERT INTO titles (code, name, description, icon, condition_type, condition_value, condition_extra, rarity, sort_order)
		VALUES (@code, @name, @description, @icon, @conditionType, @conditionValue, @conditionExtra, @rarity, @sortOrder)
	`);

	const insertAll = db.transaction(() => {
		for (const t of titlesData) {
			insert.run(t);
			console.log(`  INSERT: ${t.name} (${t.icon}, ${t.rarity})`);
		}
	});

	insertAll();
	console.log(`\n称号マスタ: ${titlesData.length}件投入完了`);
} else {
	console.log(`  SKIP: titles already seeded (${existingTitles.cnt} items)`);
}

db.close();
console.log('Done.');
