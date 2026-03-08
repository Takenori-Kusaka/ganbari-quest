// scripts/update-daily-limits.cjs
// 既存活動のdailyLimit一括設定スクリプト
// Usage: node scripts/update-daily-limits.cjs [DATABASE_PATH]

const Database = require('better-sqlite3');
const dbPath = process.argv[2] || './data/ganbari-quest.db';
const db = new Database(dbPath);

// dailyLimit = 3: ごはん系 (朝・昼・晩の3食)
const meal3 = ['ごはんをたべた', 'ごはんをぜんぶたべた'];

// dailyLimit = 3: 手洗い系 (食事前・トイレ後・外出後)
const hygiene3 = ['てをあらった', 'てあらい・うがいした', '手洗い・うがいした'];

// dailyLimit = 3: 食事片付け系 (毎食後)
const cleanup3 = ['おさらあらい', 'テーブルをふく', '皿洗い'];

// dailyLimit = 2: はみがき系 (朝・晩)
const teeth2 = ['はみがきした', 'はみがき・せいけつ'];

// dailyLimit = 2: おかたづけ・整理系 (遊び後 + 就寝前)
const tidy2 = ['おかたづけした', 'じぶんのもちものをせいり', '整理整頓・掃除', 'くつをそろえる'];

// dailyLimit = 2: お手伝い・家事系 (複数回のお手伝い機会)
const chore2 = [
	'おてつだいした',
	'りょうりのおてつだい',
	'調理実習・料理のお手伝い',
	'家庭の仕事を分担',
	'家事の分担・実践',
	'家事の自立的実践',
];

// dailyLimit = 2: あいさつ系 (朝の挨拶 + 帰宅時)
const greet2 = ['あいさつした', 'あいさつ・へんじ', 'あいさつ・言葉遣い'];

// dailyLimit = 2: 水やり (朝・夕)
const water2 = ['水やりをする'];

function updateBatch(names, limit) {
	const placeholders = names.map(() => '?').join(', ');
	const stmt = db.prepare(`UPDATE activities SET daily_limit = ? WHERE name IN (${placeholders})`);
	const result = stmt.run(limit, ...names);
	return result.changes;
}

let totalChanged = 0;

const updates = [
	{ names: meal3, limit: 3, label: 'ごはん系 (3回/日)' },
	{ names: hygiene3, limit: 3, label: '手洗い系 (3回/日)' },
	{ names: cleanup3, limit: 3, label: '食事片付け系 (3回/日)' },
	{ names: teeth2, limit: 2, label: 'はみがき系 (2回/日)' },
	{ names: tidy2, limit: 2, label: 'おかたづけ・整理系 (2回/日)' },
	{ names: chore2, limit: 2, label: 'お手伝い・家事系 (2回/日)' },
	{ names: greet2, limit: 2, label: 'あいさつ系 (2回/日)' },
	{ names: water2, limit: 2, label: '水やり (2回/日)' },
];

for (const { names, limit, label } of updates) {
	const changed = updateBatch(names, limit);
	console.log(`  ${label}: ${changed}件更新`);
	totalChanged += changed;
}

console.log(`\n合計: ${totalChanged}件の活動を更新しました`);

// 確認出力
const updated = db
	.prepare('SELECT id, name, daily_limit FROM activities WHERE daily_limit IS NOT NULL ORDER BY daily_limit DESC, id')
	.all();
console.log('\n更新された活動一覧:');
for (const r of updated) {
	console.log(`  [${r.daily_limit}回/日] ID=${r.id}: ${r.name}`);
}

db.close();
