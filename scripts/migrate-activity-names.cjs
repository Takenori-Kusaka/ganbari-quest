// scripts/migrate-activity-names.cjs
// Production migration: Add name_kana and name_kanji columns to activities table
// Usage: node scripts/migrate-activity-names.cjs [database-path]
// Docker: docker compose exec app node scripts/migrate-activity-names.cjs

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`Database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Check if columns already exist
const columns = db.pragma('table_info(activities)');
const columnNames = columns.map((c) => c.name);

if (columnNames.includes('name_kana')) {
	console.log('name_kana column already exists, skipping.');
} else {
	db.exec('ALTER TABLE activities ADD COLUMN name_kana TEXT');
	console.log('Added name_kana column.');
}

if (columnNames.includes('name_kanji')) {
	console.log('name_kanji column already exists, skipping.');
} else {
	db.exec('ALTER TABLE activities ADD COLUMN name_kanji TEXT');
	console.log('Added name_kanji column.');
}

console.log('Migration complete.');
db.close();
