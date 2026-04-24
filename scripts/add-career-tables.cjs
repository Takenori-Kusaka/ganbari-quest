// scripts/add-career-tables.cjs
// #0048 キャリアプランニング機能 — テーブル作成 + 職業分野マスタ投入
//
// 使い方:
//   node scripts/add-career-tables.cjs [DBパス]
//   デフォルト: ./data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 1. career_fields テーブル作成
const hasCareerFields = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='career_fields'")
	.get();

if (!hasCareerFields) {
	db.exec(`
		CREATE TABLE career_fields (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT,
			icon TEXT,
			related_categories TEXT NOT NULL DEFAULT '[]',
			recommended_activities TEXT NOT NULL DEFAULT '[]',
			min_age INTEGER NOT NULL DEFAULT 6,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`);
	console.log('  CREATE: career_fields table');
} else {
	console.log('  SKIP: career_fields table already exists');
}

// 2. career_plans テーブル作成
const hasCareerPlans = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='career_plans'")
	.get();

if (!hasCareerPlans) {
	db.exec(`
		CREATE TABLE career_plans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			career_field_id INTEGER REFERENCES career_fields(id),
			dream_text TEXT,
			mandala_chart TEXT NOT NULL DEFAULT '{}',
			timeline_3y TEXT,
			timeline_5y TEXT,
			timeline_10y TEXT,
			target_statuses TEXT NOT NULL DEFAULT '{}',
			version INTEGER NOT NULL DEFAULT 1,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX idx_career_plans_child ON career_plans(child_id, is_active);
	`);
	console.log('  CREATE: career_plans table');
} else {
	console.log('  SKIP: career_plans table already exists');
}

// 3. career_plan_history テーブル作成
const hasCareerPlanHistory = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='career_plan_history'")
	.get();

if (!hasCareerPlanHistory) {
	db.exec(`
		CREATE TABLE career_plan_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			career_plan_id INTEGER NOT NULL REFERENCES career_plans(id),
			action TEXT NOT NULL,
			points_earned INTEGER NOT NULL DEFAULT 0,
			snapshot TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX idx_career_plan_history_plan ON career_plan_history(career_plan_id);
	`);
	console.log('  CREATE: career_plan_history table');
} else {
	console.log('  SKIP: career_plan_history table already exists');
}

// 4. 職業分野マスタデータ投入
const existingFields = db.prepare('SELECT COUNT(*) as cnt FROM career_fields').get();

if (existingFields.cnt === 0) {
	const fieldsData = [
		// relatedCategories: 1=うんどう, 2=べんきょう, 3=せいかつ, 4=こうりゅう, 5=そうぞう
		{
			name: 'かがくしゃ',
			description: '実験や研究で新しい発見をする',
			icon: '🔬',
			related: [2, 5],
			minAge: 4,
		},
		{
			name: 'おいしゃさん',
			description: '病気の人を助けて元気にする',
			icon: '🏥',
			related: [2, 3],
			minAge: 4,
		},
		{
			name: 'エンジニア',
			description: '機械やしくみを作ってみんなの生活を便利にする',
			icon: '⚙️',
			related: [2, 5],
			minAge: 8,
		},
		{
			name: 'プログラマー',
			description: 'コンピューターに命令を出してアプリやゲームを作る',
			icon: '💻',
			related: [2, 5],
			minAge: 8,
		},
		{
			name: 'がかさん',
			description: '絵を描いてみんなを感動させる',
			icon: '🎨',
			related: [5],
			minAge: 4,
		},
		{
			name: 'おんがくか',
			description: '楽器を演奏したり歌を歌ったりする',
			icon: '🎵',
			related: [5, 4],
			minAge: 4,
		},
		{
			name: 'スポーツせんしゅ',
			description: 'スポーツの大会で活躍する',
			icon: '⚽',
			related: [1],
			minAge: 4,
		},
		{
			name: 'りょうりにん',
			description: 'おいしい料理を作ってみんなを笑顔にする',
			icon: '🍳',
			related: [3, 5],
			minAge: 4,
		},
		{
			name: 'せんせい',
			description: '子供たちに勉強を教えて成長を助ける',
			icon: '📚',
			related: [2, 4],
			minAge: 4,
		},
		{
			name: 'しょうぼうし',
			description: '火事から人を助け、みんなの安全を守る',
			icon: '🚒',
			related: [1, 3],
			minAge: 4,
		},
		{
			name: 'けいさつかん',
			description: '悪い人から街を守り、みんなを安全にする',
			icon: '🚔',
			related: [1, 4],
			minAge: 4,
		},
		{
			name: 'うちゅうひこうし',
			description: '宇宙に行って地球や星を調べる',
			icon: '🚀',
			related: [1, 2],
			minAge: 4,
		},
		{
			name: 'どうぶつのおいしゃさん',
			description: '動物の病気を治して元気にする',
			icon: '🐾',
			related: [2, 3],
			minAge: 4,
		},
		{
			name: 'パティシエ',
			description: 'ケーキやお菓子を作ってみんなを幸せにする',
			icon: '🎂',
			related: [3, 5],
			minAge: 4,
		},
		{
			name: 'デザイナー',
			description: '服やポスターなど、かっこいいデザインを考える',
			icon: '✏️',
			related: [5],
			minAge: 8,
		},
		{
			name: 'けんちくか',
			description: '家やビルの設計をして、すてきな建物を作る',
			icon: '🏗️',
			related: [2, 5],
			minAge: 8,
		},
		{
			name: 'パイロット',
			description: '飛行機を運転して世界中を飛び回る',
			icon: '✈️',
			related: [1, 2],
			minAge: 4,
		},
		{
			name: 'かんごし',
			description: '病院で患者さんのお世話をして元気にする',
			icon: '💉',
			related: [3, 4],
			minAge: 4,
		},
		{
			name: 'ほいくし',
			description: '小さい子供たちのお世話をして一緒に遊ぶ',
			icon: '👶',
			related: [3, 4],
			minAge: 4,
		},
		{
			name: 'のうかさん',
			description: '野菜やお米を育ててみんなの食べ物を作る',
			icon: '🌾',
			related: [1, 3],
			minAge: 4,
		},
		{
			name: 'ユーチューバー',
			description: '動画を作ってたくさんの人に届ける',
			icon: '📱',
			related: [4, 5],
			minAge: 8,
		},
		{
			name: 'ゲームクリエイター',
			description: 'みんなが楽しめるゲームを考えて作る',
			icon: '🎮',
			related: [2, 5],
			minAge: 8,
		},
		{
			name: 'まんがか',
			description: 'まんがを描いてみんなを楽しませる',
			icon: '📖',
			related: [5],
			minAge: 4,
		},
		{
			name: 'でんしゃのうんてんし',
			description: '電車を安全に運転してみんなを届ける',
			icon: '🚃',
			related: [1, 3],
			minAge: 4,
		},
		{
			name: 'おはなやさん',
			description: 'きれいなお花を選んで素敵にアレンジする',
			icon: '💐',
			related: [3, 5],
			minAge: 4,
		},
		{
			name: 'ケーキやさん',
			description: 'おいしいケーキやパンを焼いてお店で売る',
			icon: '🧁',
			related: [3, 5],
			minAge: 4,
		},
		{
			name: 'ダンサー',
			description: '踊りで気持ちを表現してみんなを感動させる',
			icon: '💃',
			related: [1, 5],
			minAge: 4,
		},
		{
			name: 'サッカーせんしゅ',
			description: 'サッカーの試合で活躍してチームを勝たせる',
			icon: '⚽',
			related: [1, 4],
			minAge: 4,
		},
		{
			name: 'やきゅうせんしゅ',
			description: '野球の試合でホームランを打つ',
			icon: '⚾',
			related: [1, 4],
			minAge: 4,
		},
		{
			name: 'すいえいせんしゅ',
			description: 'プールや海で速く泳いで大会で活躍する',
			icon: '🏊',
			related: [1],
			minAge: 4,
		},
	];

	const insert = db.prepare(`
		INSERT INTO career_fields (name, description, icon, related_categories, recommended_activities, min_age)
		VALUES (@name, @description, @icon, @relatedCategories, '[]', @minAge)
	`);

	const insertAll = db.transaction(() => {
		for (const f of fieldsData) {
			insert.run({
				name: f.name,
				description: f.description,
				icon: f.icon,
				relatedCategories: JSON.stringify(f.related),
				minAge: f.minAge,
			});
			console.log(`  INSERT: ${f.icon} ${f.name}`);
		}
	});

	insertAll();
	console.log(`\n職業分野マスタ: ${fieldsData.length}件投入完了`);
} else {
	console.log(`  SKIP: career_fields already seeded (${existingFields.cnt} items)`);
}

// WAL checkpoint + VACUUM
console.log('  Running WAL checkpoint + VACUUM...');
db.pragma('wal_checkpoint(TRUNCATE)');
db.exec('VACUUM');

db.close();
console.log('Done.');
