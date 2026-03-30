#!/usr/bin/env node
// Migration: rest_days テーブルを作成
// Usage: node scripts/add-rest-days-table.cjs [db-path]
// Default db-path: data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.resolve(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`[migrate] Opening database: ${dbPath}`);

const db = new Database(dbPath);

// Check if table already exists
const tableExists = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rest_days'")
	.get();

if (tableExists) {
	console.log('[migrate] rest_days table already exists. Skipping.');
} else {
	db.exec(`
		CREATE TABLE rest_days (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			date TEXT NOT NULL,
			reason TEXT NOT NULL DEFAULT 'rest',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX idx_rest_days_child_date ON rest_days(child_id, date);
	`);
	console.log('[migrate] Created rest_days table with unique index.');
}

db.close();
console.log('[migrate] Done.');
