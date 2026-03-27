#!/usr/bin/env node
// Migration: children テーブルに display_config カラムを追加
// Usage: node scripts/add-display-config.cjs [db-path]
// Default db-path: data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.resolve(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`[migrate] Opening database: ${dbPath}`);

const db = new Database(dbPath);

// Check if column already exists
const columns = db.pragma('table_info(children)');
const hasColumn = columns.some((col) => col.name === 'display_config');

if (hasColumn) {
	console.log('[migrate] display_config column already exists. Skipping.');
} else {
	db.exec('ALTER TABLE children ADD COLUMN display_config TEXT');
	console.log('[migrate] Added display_config column to children table.');
}

db.close();
console.log('[migrate] Done.');
