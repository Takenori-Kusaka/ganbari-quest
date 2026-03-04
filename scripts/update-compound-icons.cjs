#!/usr/bin/env node
// scripts/update-compound-icons.cjs
// 本番DB: 既存活動のアイコンを複合アイコンに更新するマイグレーションスクリプト
// 実行: node scripts/update-compound-icons.cjs
// Docker: docker exec -w /app ganbari-quest-app-1 node scripts/update-compound-icons.cjs

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_URL
	? process.env.DATABASE_URL.replace('file:', '')
	: path.join(__dirname, '..', 'data', 'ganbari-quest.db');

console.log(`[compound-icons] DB: ${DB_PATH}`);

const db = new Database(DB_PATH);

// name + old_icon → new_icon のマッピング
const updates = [
	{ name: 'てをあらった', oldIcon: '🧼', newIcon: '🤲💧' },
	{ name: 'てあらい・うがいした', oldIcon: '💧', newIcon: '🤲💧' },
	{ name: 'おかたづけした', oldIcon: '🧹', newIcon: '🧹✨' },
	{ name: 'おさらあらい', oldIcon: '🍽️', newIcon: '🍽️💧' },
	{ name: 'おへやをそうじする', oldIcon: '🧹', newIcon: '🧹🏠' },
	{ name: '部屋を掃除する', oldIcon: '🧹', newIcon: '🧹🏠' },
	{ name: 'お風呂を掃除する', oldIcon: '🛁', newIcon: '🛁🧹' },
	{ name: 'トイレを掃除する', oldIcon: '🚽', newIcon: '🚽🧹' },
	{ name: '洗面台を掃除する', oldIcon: '🪥', newIcon: '🪥🧹' },
	{ name: '玄関を掃除する', oldIcon: '🚪', newIcon: '🚪🧹' },
	{ name: 'もちものチェックした', oldIcon: '✅', newIcon: '🎒✅' },
	{ name: 'あしたのじゅんびした', oldIcon: '✅', newIcon: '🎒📝' },
	{ name: '水やりをする', oldIcon: '🌱', newIcon: '🌱💧' },
	{ name: 'くつを洗う', oldIcon: '👟', newIcon: '👟💧' },
	{ name: '洗濯をする', oldIcon: '🫧', newIcon: '👕🫧' },
];

const stmt = db.prepare(`
	UPDATE activities
	SET icon = ?
	WHERE name = ? AND icon = ?
`);

let totalUpdated = 0;

const transaction = db.transaction(() => {
	for (const { name, oldIcon, newIcon } of updates) {
		const result = stmt.run(newIcon, name, oldIcon);
		if (result.changes > 0) {
			console.log(`  ✅ ${name}: ${oldIcon} → ${newIcon} (${result.changes} rows)`);
			totalUpdated += result.changes;
		} else {
			console.log(`  ⏭️  ${name}: not found or already updated`);
		}
	}
});

transaction();

console.log(`\n[compound-icons] Done: ${totalUpdated} activities updated`);
db.close();
