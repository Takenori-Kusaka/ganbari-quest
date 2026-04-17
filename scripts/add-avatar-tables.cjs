// scripts/add-avatar-tables.cjs
// #0086 きせかえアバター — テーブル作成 + 初期データ投入
//
// 使い方:
//   node scripts/add-avatar-tables.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Step 1: テーブル作成
const tables = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='avatar_items'")
	.get();
if (!tables) {
	console.log('テーブル作成: avatar_items, child_avatar_items');
	db.exec(`
		CREATE TABLE avatar_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			description TEXT,
			category TEXT NOT NULL,
			icon TEXT NOT NULL,
			css_value TEXT NOT NULL,
			price INTEGER NOT NULL DEFAULT 0,
			unlock_type TEXT NOT NULL DEFAULT 'purchase',
			unlock_condition TEXT,
			rarity TEXT NOT NULL DEFAULT 'common',
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE child_avatar_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			avatar_item_id INTEGER NOT NULL REFERENCES avatar_items(id),
			acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX idx_child_avatar_items_unique
			ON child_avatar_items(child_id, avatar_item_id);
	`);
	console.log('  テーブル作成完了');
} else {
	console.log('テーブル作成: 不要（既存）');
}

// Step 2: children テーブルにカラム追加
const columns = db.pragma('table_info(children)');
const colNames = columns.map((c) => c.name);

const newCols = [
	{ name: 'active_avatar_bg', type: 'INTEGER' },
	{ name: 'active_avatar_frame', type: 'INTEGER' },
	{ name: 'active_avatar_effect', type: 'INTEGER' },
];
for (const col of newCols) {
	if (!colNames.includes(col.name)) {
		db.exec(`ALTER TABLE children ADD COLUMN ${col.name} ${col.type}`);
		console.log(`  カラム追加: children.${col.name}`);
	}
}

// Step 3: 初期アイテムデータ投入
const avatarItems = [
	{
		code: 'bg_default',
		name: 'しろ',
		category: 'background',
		icon: '⬜',
		css_value: '#ffffff',
		price: 0,
		unlock_type: 'free',
		rarity: 'common',
		sort_order: 1,
	},
	{
		code: 'bg_sakura',
		name: 'さくらいろ',
		category: 'background',
		icon: '🌸',
		css_value: 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
		price: 100,
		unlock_type: 'purchase',
		rarity: 'common',
		sort_order: 2,
	},
	{
		code: 'bg_sky',
		name: 'そらいろ',
		category: 'background',
		icon: '☁️',
		css_value: 'linear-gradient(135deg, #e3f2fd, #90caf9)',
		price: 100,
		unlock_type: 'purchase',
		rarity: 'common',
		sort_order: 3,
	},
	{
		code: 'bg_sunset',
		name: 'ゆうやけ',
		category: 'background',
		icon: '🌅',
		css_value: 'linear-gradient(135deg, #fff3e0, #ffcc80, #ff8a65)',
		price: 200,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 4,
	},
	{
		code: 'bg_rainbow',
		name: 'にじいろ',
		category: 'background',
		icon: '🌈',
		css_value: 'linear-gradient(135deg, #ffcdd2, #fff9c4, #c8e6c9, #bbdefb, #e1bee7)',
		price: 300,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 5,
	},
	{
		code: 'bg_galaxy',
		name: 'うちゅう',
		category: 'background',
		icon: '🌌',
		css_value: 'linear-gradient(135deg, #1a237e, #4a148c, #880e4f)',
		price: 500,
		unlock_type: 'purchase',
		rarity: 'epic',
		sort_order: 6,
	},
	{
		code: 'bg_gold',
		name: 'おうごん',
		category: 'background',
		icon: '👑',
		css_value: 'linear-gradient(135deg, #ffd54f, #ffb300, #ff8f00)',
		price: 500,
		unlock_type: 'purchase',
		rarity: 'epic',
		sort_order: 7,
	},
	{
		code: 'bg_legend',
		name: 'でんせつ',
		category: 'background',
		icon: '🌟',
		css_value: 'linear-gradient(135deg, #e8eaf6, #c5cae9, #9fa8da, #7986cb)',
		price: 0,
		unlock_type: 'level',
		unlock_condition: '{"level":10}',
		rarity: 'legendary',
		sort_order: 8,
	},
	{
		code: 'frame_default',
		name: 'ふつう',
		category: 'frame',
		icon: '⬜',
		css_value: '2px solid #bdbdbd',
		price: 0,
		unlock_type: 'free',
		rarity: 'common',
		sort_order: 1,
	},
	{
		code: 'frame_star',
		name: 'ほし',
		category: 'frame',
		icon: '⭐',
		css_value: '3px solid #ffd700',
		price: 150,
		unlock_type: 'purchase',
		rarity: 'common',
		sort_order: 2,
	},
	{
		code: 'frame_heart',
		name: 'はーと',
		category: 'frame',
		icon: '💖',
		css_value: '3px solid #ff69b4',
		price: 150,
		unlock_type: 'purchase',
		rarity: 'common',
		sort_order: 3,
	},
	{
		code: 'frame_fire',
		name: 'ほのお',
		category: 'frame',
		icon: '🔥',
		css_value: '3px solid #ff5722',
		price: 300,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 4,
	},
	{
		code: 'frame_diamond',
		name: 'ダイヤ',
		category: 'frame',
		icon: '💎',
		css_value: '3px solid #00bcd4',
		price: 500,
		unlock_type: 'purchase',
		rarity: 'epic',
		sort_order: 5,
	},
	{
		code: 'frame_crown',
		name: 'おうかん',
		category: 'frame',
		icon: '👑',
		css_value: '3px double #ffd700',
		price: 0,
		unlock_type: 'level',
		unlock_condition: '{"level":8}',
		rarity: 'legendary',
		sort_order: 6,
	},
	{
		code: 'effect_none',
		name: 'なし',
		category: 'effect',
		icon: '➖',
		css_value: '',
		price: 0,
		unlock_type: 'free',
		rarity: 'common',
		sort_order: 1,
	},
	{
		code: 'effect_sparkle',
		name: 'キラキラ',
		category: 'effect',
		icon: '✨',
		css_value: 'sparkle',
		price: 200,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 2,
	},
	{
		code: 'effect_pulse',
		name: 'ドキドキ',
		category: 'effect',
		icon: '💓',
		css_value: 'pulse',
		price: 200,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 3,
	},
	{
		code: 'effect_glow',
		name: 'かがやき',
		category: 'effect',
		icon: '🔆',
		css_value: 'glow',
		price: 400,
		unlock_type: 'purchase',
		rarity: 'epic',
		sort_order: 4,
	},
	{
		code: 'effect_rainbow',
		name: 'にじ',
		category: 'effect',
		icon: '🌈',
		css_value: 'rainbow',
		price: 0,
		unlock_type: 'level',
		unlock_condition: '{"level":7}',
		rarity: 'legendary',
		sort_order: 5,
	},
];

const checkItem = db.prepare('SELECT id FROM avatar_items WHERE code = ?');
const insertItem = db.prepare(`
	INSERT INTO avatar_items (code, name, category, icon, css_value, price, unlock_type, unlock_condition, rarity, sort_order)
	VALUES (@code, @name, @category, @icon, @css_value, @price, @unlock_type, @unlock_condition, @rarity, @sort_order)
`);

let inserted = 0;
const insertAll = db.transaction(() => {
	for (const item of avatarItems) {
		const existing = checkItem.get(item.code);
		if (!existing) {
			insertItem.run({ unlock_condition: null, ...item });
			inserted++;
		}
	}
});
insertAll();
console.log(`アイテム: ${inserted}件追加 (既存スキップ: ${avatarItems.length - inserted}件)`);

// Step 4: 全子供にデフォルトアイテムを付与
const allChildren = db.prepare('SELECT id FROM children').all();
const defaultItems = db.prepare("SELECT id FROM avatar_items WHERE unlock_type = 'free'").all();
const checkOwned = db.prepare(
	'SELECT id FROM child_avatar_items WHERE child_id = ? AND avatar_item_id = ?',
);
const insertOwned = db.prepare(
	'INSERT INTO child_avatar_items (child_id, avatar_item_id) VALUES (?, ?)',
);

let granted = 0;
const grantAll = db.transaction(() => {
	for (const child of allChildren) {
		for (const item of defaultItems) {
			if (!checkOwned.get(child.id, item.id)) {
				insertOwned.run(child.id, item.id);
				granted++;
			}
		}
	}
});
grantAll();
console.log(
	`デフォルトアイテム付与: ${granted}件 (${allChildren.length}人 × ${defaultItems.length}アイテム)`,
);

// Step 5: VACUUM + WAL checkpoint
db.exec('VACUUM');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('Done.');
