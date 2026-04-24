#!/usr/bin/env node
// scripts/add-user-id-column.cjs
// children テーブルに user_id カラムを追加するマイグレーション
// 使い方: node scripts/add-user-id-column.cjs [dbpath]

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`[migrate] Opening database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// children テーブルに user_id カラムが存在するか確認
const columns = db.prepare("PRAGMA table_info('children')").all();
const hasUserId = columns.some((col) => col.name === 'user_id');

if (hasUserId) {
	console.log('[migrate] user_id column already exists. Skipping.');
} else {
	console.log('[migrate] Adding user_id column to children table...');
	db.prepare('ALTER TABLE children ADD COLUMN user_id TEXT').run();
	console.log('[migrate] Done. user_id column added.');
}

db.close();
console.log('[migrate] Database closed.');
