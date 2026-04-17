// scripts/add-shop-items-sound-celebration.cjs
// #0156 — 既存 DB に sound / celebration カテゴリのアイテムを安全に追加
//
// 使い方:
//   node scripts/add-shop-items-sound-celebration.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db
//
// seed.ts に定義されている全 avatar_items のうち、
// 既存 DB に不足しているアイテムのみを冪等に INSERT する。

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// seed.ts と同一のアイテム定義
const items = [
	// --- きろくおん（サウンド） ---
	{
		code: 'sound_default',
		name: 'ノーマル',
		category: 'sound',
		icon: '🔔',
		css_value: '/sounds/record-complete.mp3',
		price: 0,
		unlock_type: 'free',
		rarity: 'common',
		sort_order: 1,
		description: null,
	},
	{
		code: 'sound_fanfare',
		name: 'ファンファーレ',
		category: 'sound',
		icon: '🎺',
		css_value: '/sounds/custom/fanfare.mp3',
		price: 100,
		unlock_type: 'purchase',
		rarity: 'common',
		sort_order: 2,
		description: 'あかるいトランペットのたっせいおん',
	},
	{
		code: 'sound_chiptune',
		name: 'ゲームクリア',
		category: 'sound',
		icon: '🎮',
		css_value: '/sounds/custom/chiptune.mp3',
		price: 100,
		unlock_type: 'purchase',
		rarity: 'common',
		sort_order: 3,
		description: 'レトロゲームふうチャイム',
	},
	{
		code: 'sound_orchestra',
		name: 'オーケストラ',
		category: 'sound',
		icon: '🎻',
		css_value: '/sounds/custom/orchestra.mp3',
		price: 200,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 4,
		description: 'そうだいなオーケストラふう',
	},
	{
		code: 'sound_magic',
		name: 'まほうのおと',
		category: 'sound',
		icon: '🪄',
		css_value: '/sounds/custom/magic.mp3',
		price: 200,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 5,
		description: 'キラキラしたまほうこうかおん',
	},
	{
		code: 'sound_power',
		name: 'パワーアップ',
		category: 'sound',
		icon: '⚡',
		css_value: '/sounds/custom/power.mp3',
		price: 400,
		unlock_type: 'purchase',
		rarity: 'epic',
		sort_order: 6,
		description: 'ちからづよいパワーアップおん',
	},
	{
		code: 'sound_legend',
		name: 'でんせつのおと',
		category: 'sound',
		icon: '🌟',
		css_value: '/sounds/custom/legend.mp3',
		price: 0,
		unlock_type: 'level',
		rarity: 'legendary',
		sort_order: 7,
		description: 'そうだいなでんせつふう',
		unlock_condition: '{"level":9}',
	},
	// --- たっせいえんしゅつ（セレブレーション演出） ---
	{
		code: 'celeb_default',
		name: 'ノーマル',
		category: 'celebration',
		icon: '✅',
		css_value: 'default',
		price: 0,
		unlock_type: 'free',
		rarity: 'common',
		sort_order: 1,
		description: null,
	},
	{
		code: 'celeb_confetti',
		name: 'かみふぶき',
		category: 'celebration',
		icon: '🎊',
		css_value: 'confetti',
		price: 150,
		unlock_type: 'purchase',
		rarity: 'common',
		sort_order: 2,
		description: 'カラフルなかみふぶきがまう',
	},
	{
		code: 'celeb_fireworks',
		name: 'はなび',
		category: 'celebration',
		icon: '🎆',
		css_value: 'fireworks',
		price: 250,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 3,
		description: 'はなびがうちあがるアニメーション',
	},
	{
		code: 'celeb_stars',
		name: 'ほしふる',
		category: 'celebration',
		icon: '🌠',
		css_value: 'stars',
		price: 250,
		unlock_type: 'purchase',
		rarity: 'rare',
		sort_order: 4,
		description: 'ほしがふりそそぐエフェクト',
	},
	{
		code: 'celeb_cracker',
		name: 'クラッカー',
		category: 'celebration',
		icon: '🎉',
		css_value: 'cracker',
		price: 400,
		unlock_type: 'purchase',
		rarity: 'epic',
		sort_order: 5,
		description: 'クラッカーがはじけるアニメーション',
	},
	{
		code: 'celeb_rainbow',
		name: 'にじのばくはつ',
		category: 'celebration',
		icon: '🌈',
		css_value: 'rainbow',
		price: 400,
		unlock_type: 'purchase',
		rarity: 'epic',
		sort_order: 6,
		description: 'がめんぜんたいににじいろのはもんがひろがる',
	},
	{
		code: 'celeb_legend',
		name: 'でんせつのひかり',
		category: 'celebration',
		icon: '👑',
		css_value: 'legend',
		price: 0,
		unlock_type: 'level',
		rarity: 'legendary',
		sort_order: 7,
		description: 'きんいろのオーラとひかりのりゅうし',
		unlock_condition: '{"level":10}',
	},
];

const existingCodes = new Set(
	db
		.prepare('SELECT code FROM avatar_items')
		.all()
		.map((r) => r.code),
);

const insertStmt = db.prepare(`
	INSERT INTO avatar_items (code, name, category, icon, css_value, price, unlock_type, unlock_condition, rarity, sort_order, description)
	VALUES (@code, @name, @category, @icon, @css_value, @price, @unlock_type, @unlock_condition, @rarity, @sort_order, @description)
`);

const missing = items.filter((i) => !existingCodes.has(i.code));

if (missing.length === 0) {
	console.log('全アイテムが既に存在します。追加不要です。');
} else {
	const tx = db.transaction(() => {
		for (const item of missing) {
			insertStmt.run({
				...item,
				unlock_condition: item.unlock_condition ?? null,
				description: item.description ?? null,
			});
		}
	});
	tx();
	console.log(`✓ ${missing.length} 件のアイテムを追加しました:`);
	for (const item of missing) {
		console.log(`  - ${item.code} (${item.category}): ${item.name}`);
	}
}

db.close();
console.log('完了');
