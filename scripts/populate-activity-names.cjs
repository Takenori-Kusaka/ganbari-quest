// scripts/populate-activity-names.cjs
// Production migration: Populate nameKana/nameKanji + merge duplicate hiragana/kanji pairs
// Usage: node scripts/populate-activity-names.cjs [database-path]
// Docker: docker compose exec app node scripts/populate-activity-names.cjs

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`Database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ============================================================
// Phase 1: Merge kinder/elementary pairs
// Strategy: expand kinder version's age range, add nameKanji, hide the duplicate
// ============================================================
const mergePairs = [
	// [keepId, hideId, newAgeMin, newAgeMax, nameKanji]
	[33, 178, 1, 18, '手洗い・うがいをした'], // てあらい・うがいした (3→5) ↔ 手洗い・うがいした (7→18)
	[152, 155, 3, 9, '皿洗い'], // おさらあらい (3→5) ↔ 皿洗い (6→9)
	[159, 161, 3, 9, '洗濯物をたたむ'], // せんたくものをたたむ (3→5) ↔ 洗濯物をたたむ (6→9)
	[165, 167, 3, 18, '部屋を掃除する'], // おへやをそうじする (3→5) ↔ 部屋を掃除する (6→18)
	[174, 175, 3, 18, '買い物をする'], // かいものにいく (3→5) ↔ 買い物をする (6→18)
];

console.log('\n=== Phase 1: Merge pairs ===');
const updateKeep = db.prepare(
	'UPDATE activities SET age_min = ?, age_max = ?, name_kanji = ? WHERE id = ?',
);
const hideActivity = db.prepare('UPDATE activities SET is_visible = 0 WHERE id = ?');
const migrateLogsStmt = db.prepare(
	'UPDATE activity_logs SET activity_id = ? WHERE activity_id = ?',
);

for (const [keepId, hideId, ageMin, ageMax, nameKanji] of mergePairs) {
	const keep = db.prepare('SELECT id, name FROM activities WHERE id = ?').get(keepId);
	const hide = db.prepare('SELECT id, name FROM activities WHERE id = ?').get(hideId);
	if (!keep || !hide) {
		console.log(`  SKIP: id=${keepId} or id=${hideId} not found`);
		continue;
	}
	// Migrate any activity logs from the hidden activity to the kept one
	const logCount = db
		.prepare('SELECT COUNT(*) as cnt FROM activity_logs WHERE activity_id = ?')
		.get(hideId);
	if (logCount.cnt > 0) {
		migrateLogsStmt.run(keepId, hideId);
		console.log(`  LOGS: Migrated ${logCount.cnt} records from id=${hideId} → id=${keepId}`);
	}
	updateKeep.run(ageMin, ageMax, nameKanji, keepId);
	hideActivity.run(hideId);
	console.log(
		`  MERGED: id=${keepId} "${keep.name}" (→${ageMin}-${ageMax}, kanji="${nameKanji}") | HIDDEN: id=${hideId} "${hide.name}"`,
	);
}

// ============================================================
// Phase 2: Fill nameKana/nameKanji for wide-range activities
// ============================================================
console.log('\n=== Phase 2: Fill nameKana/nameKanji ===');
const updateNames = db.prepare('UPDATE activities SET name_kana = ?, name_kanji = ? WHERE id = ?');
const updateKana = db.prepare('UPDATE activities SET name_kana = ? WHERE id = ?');
const updateKanji = db.prepare('UPDATE activities SET name_kanji = ? WHERE id = ?');

// Activities that span the 6-year boundary or have kanji in name shown to young kids
const nameUpdates = [
	// [id, nameKana, nameKanji]
	// Wide-range activities (ageMin < 6, ageMax >= 6) — need both forms
	[180, null, 'お風呂掃除をした'], // おふろそうじした (3-18) — already ひらがな
	[182, null, 'お風呂に入った'], // おふろはいった (0-18)
	[183, null, '科学館に行った'], // かがくかんにいった (1-18)
	[173, null, 'お布団をたたむ'], // おふとんをたたむ (3-18)
	[177, null, 'お便りを渡す'], // おたよりをわたす (3-9)
	[176, 'みずやりをする', null], // 水やりをする (3-18)

	// Activities starting at 6+ that may benefit from kana for readability
	[156, 'りょうりする', null], // 料理する (6-18)
	[162, 'せんたくものをほす', null], // 洗濯物を干す (6-18)
	[164, 'くつをあらう', null], // くつを洗う (6-18) — mixed
	[168, 'おふろをそうじする', null], // お風呂を掃除する (6-18)
	[169, 'トイレをそうじする', null], // トイレを掃除する (6-18)
	[170, 'せんめんだいをそうじする', null], // 洗面台を掃除する (6-18)
	[171, 'げんかんをそうじする', null], // 玄関を掃除する (6-18)
	[172, 'ゴミをだす', null], // ゴミを出す (6-18)
	[163, 'せんたくをする', null], // 洗濯をする (10-18)

	// kinder activities — add nameKanji for when child grows up
	[29, null, 'お着替えをした'], // おきがえした (3-5)
	[30, null, '歯みがきをした'], // はみがきした (3-5)
	[31, null, 'ご飯を全部食べた'], // ごはんをぜんぶたべた (3-5)
	[32, null, 'お片付けをした'], // おかたづけした (3-5)
	[34, null, '早寝早起きをした'], // はやねはやおきした (3-5)
	[35, null, '持ち物チェックをした'], // もちものチェックした (3-5)
	[17, null, '体操をした'], // たいそうした (3-5)
	[18, null, '外で遊んだ'], // おそとであそんだ (3-5)
	[19, null, 'スイミング'], // すいみんぐ (3-5)
	[20, null, 'ボール遊び'], // ボールあそび (3-5)
	[21, null, '鬼ごっこ'], // おにごっこ (3-5)
	[22, null, 'なわとび練習'], // なわとびれんしゅう (4-5)
	[23, null, 'ひらがな練習'], // ひらがなれんしゅう (3-5)
	[24, null, '数字を数えた'], // すうじをかぞえた (3-5)
	[25, null, '絵本を読んだ'], // えほんをよんだ (3-5)
	[26, null, '図書館に行った'], // としょかんにいった (3-5)
	[27, null, '自然を観察した'], // しぜんをかんさつした (3-5)
	[28, null, '動物・植物のお世話'], // どうぶつ・しょくぶつのおせわ (3-5)
	[36, null, '友達と遊んだ'], // ともだちとあそんだ (3-5)
	[37, null, '挨拶をした'], // あいさつした (3-5)
	[38, null, '自分の気持ちを伝えた'], // じぶんのきもちをつたえた (3-5)
	[39, null, '約束を守った'], // おやくそくをまもった (3-5)
	[40, null, 'お絵描きをした'], // おえかきした (3-5)
	[41, null, '工作をした'], // こうさくした (3-5)
	[42, null, '歌を歌った'], // うたをうたった (3-5)
	[43, null, '楽器で遊んだ'], // がっきであそんだ (3-5)
	[44, null, 'ダンス・踊り'], // ダンス・おどり (3-5)
	[45, null, 'ごっこ遊び'], // ごっこあそび (3-5)
	[153, null, 'テーブルを拭く'], // テーブルをふく (3-5)
	[154, null, '料理のお手伝い'], // りょうりのおてつだい (3-5)
	[160, null, '洗濯物をしまう'], // せんたくものをしまう (3-5)
	[166, null, '靴をそろえる'], // くつをそろえる (3-5)

	// elementary_lower — add nameKana for lower-grade kids
	[46, 'たいそう・ストレッチ', null], // たいそう・ストレッチ (6-9) — already kana
	[47, 'かけっこ・おにごっこ', null], // かけっこ・おにごっこ (6-9) — already kana
	[48, null, null], // なわとび — already fine
	[49, 'マットうんどう', null], // マットうんどう (6-9) — already kana
	[50, 'みずあそび・プール', null], // みずあそび・プール (6-9) — already kana
	[51, 'ボールゲーム', null], // ボールゲーム (6-9) — already kana
	[58, 'はみがき・せいけつ', null], // はみがき・せいけつ (6-9) — already kana
	[59, 'はやねはやおき', null], // はやねはやおき (6-9) — already kana
	[60, 'おてつだいした', null], // おてつだいした (6-9) — already kana
	[61, 'じぶんのもちものをせいり', null], // じぶんのもちものをせいり (6-9) — already kana
	[62, 'あしたのじゅんびした', null], // あしたのじゅんびした (6-9) — already kana
	[63, 'あいさつ・へんじ', null], // あいさつ・へんじ (6-9) — already kana
	[64, 'ともだちとなかよくした', null], // ともだちとなかよくした (6-9) — already kana
	[65, 'じぶんのかんがえをはなした', null], // じぶんのかんがえをはなした (6-9) — already kana
	[52, 'こくごドリル', null], // こくごドリル (6-9)
	[53, 'さんすうドリル', null], // さんすうドリル (6-9)
	[54, 'どくしょ（20ぷん）', null], // どくしょ (6-9)
	[55, 'しぜんかんさつ', null], // しぜんかんさつ (6-9)
	[56, 'どうぶつ・しょくぶつのせわ', null], // (6-9)
	[57, 'にっきをかいた', null], // にっきをかいた (6-9)
	[66, 'リズムあそび・ダンス', null], // (6-9)
	[67, 'おえかき・ずがこうさく', null], // (6-9)
	[68, 'こうさく', null], // (6-9)
	[69, 'うた・がっき', null], // (6-9)
	[70, 'おんがくをきいた', null], // (6-9)
];

for (const [id, nameKana, nameKanji] of nameUpdates) {
	if (nameKana === null && nameKanji === null) continue;
	const activity = db.prepare('SELECT id, name FROM activities WHERE id = ?').get(id);
	if (!activity) {
		console.log(`  SKIP: id=${id} not found`);
		continue;
	}
	if (nameKana && nameKanji) {
		updateNames.run(nameKana, nameKanji, id);
		console.log(`  id=${id} "${activity.name}" → kana="${nameKana}", kanji="${nameKanji}"`);
	} else if (nameKana) {
		updateKana.run(nameKana, id);
		console.log(`  id=${id} "${activity.name}" → kana="${nameKana}"`);
	} else if (nameKanji) {
		updateKanji.run(nameKanji, id);
		console.log(`  id=${id} "${activity.name}" → kanji="${nameKanji}"`);
	}
}

// ============================================================
// Summary
// ============================================================
const totalActivities = db.prepare('SELECT COUNT(*) as cnt FROM activities').get();
const visibleActivities = db
	.prepare('SELECT COUNT(*) as cnt FROM activities WHERE is_visible = 1')
	.get();
const withKana = db
	.prepare('SELECT COUNT(*) as cnt FROM activities WHERE name_kana IS NOT NULL')
	.get();
const withKanji = db
	.prepare('SELECT COUNT(*) as cnt FROM activities WHERE name_kanji IS NOT NULL')
	.get();

console.log('\n=== Summary ===');
console.log(`Total activities: ${totalActivities.cnt}`);
console.log(`Visible: ${visibleActivities.cnt}`);
console.log(`With nameKana: ${withKana.cnt}`);
console.log(`With nameKanji: ${withKanji.cnt}`);

db.close();
console.log('\nMigration complete.');
