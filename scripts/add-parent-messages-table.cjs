#!/usr/bin/env node
// Migration: parent_messages テーブルを作成
// Usage: node scripts/add-parent-messages-table.cjs [db-path]
// Default db-path: data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.resolve(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`[migrate] Opening database: ${dbPath}`);

const db = new Database(dbPath);

// Check if table already exists
const tableExists = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parent_messages'")
	.get();

if (tableExists) {
	console.log('[migrate] parent_messages table already exists. Skipping.');
} else {
	db.exec(`
		CREATE TABLE parent_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			message_type TEXT NOT NULL,
			stamp_code TEXT,
			body TEXT,
			icon TEXT NOT NULL DEFAULT '💌',
			sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			shown_at TEXT
		);
		CREATE INDEX idx_parent_messages_child ON parent_messages(child_id, sent_at);
		CREATE INDEX idx_parent_messages_unshown ON parent_messages(child_id, shown_at);
	`);
	console.log('[migrate] Created parent_messages table with indexes.');
}

db.close();
console.log('[migrate] Done.');
