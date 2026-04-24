// scripts/add-kouryuu-activities.cjs
// #0094 こうりゅうカテゴリの活動拡充 — kinder向け3活動追加
//
// 使い方:
//   node scripts/add-kouryuu-activities.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const newActivities = [
	{
		name: 'せんせいとおはなしした',
		categoryId: 4,
		icon: '👩‍🏫',
		basePoints: 3,
		ageMin: 3,
		ageMax: 5,
		source: 'seed',
		gradeLevel: 'kinder',
		subcategory: '伝達',
		description: '先生に自分のことを話したり質問したりする',
	},
	{
		name: 'いっしょにごはんたべた',
		categoryId: 4,
		icon: '🍽️👫',
		basePoints: 2,
		ageMin: 3,
		ageMax: 5,
		source: 'seed',
		gradeLevel: 'kinder',
		subcategory: '食事',
		description: '家族や友達と一緒に楽しく食事する',
	},
	{
		name: 'おてがみをかいた',
		categoryId: 4,
		icon: '✉️',
		basePoints: 3,
		ageMin: 3,
		ageMax: 5,
		source: 'seed',
		gradeLevel: 'kinder',
		subcategory: '伝達',
		description: '友達や家族にお手紙やカードを書く',
	},
];

// 現在の最大sortOrderを取得（kinder + こうりゅう）
const maxSort = db
	.prepare(
		`SELECT COALESCE(MAX(sort_order), 0) as m FROM activities WHERE category_id = 4 AND grade_level = 'kinder'`,
	)
	.get();
let sortOrder = maxSort.m + 1;

const insert = db.prepare(`
  INSERT INTO activities (name, category_id, icon, base_points, age_min, age_max, source, grade_level, subcategory, description, sort_order, is_visible)
  VALUES (@name, @categoryId, @icon, @basePoints, @ageMin, @ageMax, @source, @gradeLevel, @subcategory, @description, @sortOrder, 1)
`);

const insertAll = db.transaction(() => {
	for (const act of newActivities) {
		// 重複チェック
		const existing = db
			.prepare('SELECT id FROM activities WHERE name = ? AND category_id = 4')
			.get(act.name);
		if (existing) {
			console.log(`  SKIP (既に存在): ${act.name}`);
			continue;
		}
		insert.run({ ...act, sortOrder: sortOrder++ });
		console.log(`  ADD: ${act.name} (${act.icon}, ${act.basePoints}P)`);
	}
});

insertAll();

// 確認
const count = db
	.prepare(
		`SELECT COUNT(*) as cnt FROM activities WHERE category_id = 4 AND grade_level = 'kinder'`,
	)
	.get();
console.log(`\nkinder こうりゅう活動数: ${count.cnt}個`);

db.close();
console.log('Done.');
