// src/lib/server/db/client.ts
// DB クライアント初期化（better-sqlite3 + Drizzle ORM）

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SQL_CREATE_TABLES } from './create-tables';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL ?? './data/ganbari-quest.db';

const sqlite = new Database(DATABASE_URL);

// WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');
// Enable foreign key constraints
sqlite.pragma('foreign_keys = ON');
// Lock wait timeout (5 seconds) to avoid SQLITE_BUSY on concurrent access
sqlite.pragma('busy_timeout = 5000');
// More frequent WAL auto-checkpoint (every 100 pages instead of default 1000)
sqlite.pragma('wal_autocheckpoint = 100');
// NORMAL sync is sufficient in WAL mode (good balance of safety + performance)
sqlite.pragma('synchronous = NORMAL');

// --- Auto schema migration ---
// All statements use CREATE TABLE/INDEX IF NOT EXISTS, so this is idempotent.
// Ensures new tables are always available after code updates (NUC Docker, Lambda, dev).
if ((process.env.DATA_SOURCE ?? 'sqlite') === 'sqlite') {
	sqlite.exec(SQL_CREATE_TABLES);
}

export const db = drizzle(sqlite, { schema });
export type DrizzleDatabase = typeof db;

// Expose raw sqlite handle for shutdown checkpoint
export const rawSqlite = sqlite;

// Graceful shutdown: flush WAL and close DB on SIGTERM / SIGINT
function gracefulShutdown(signal: string) {
	console.log(`[SHUTDOWN] ${signal} received, flushing WAL and closing DB...`);
	try {
		sqlite.pragma('wal_checkpoint(TRUNCATE)');
		sqlite.close();
		console.log('[SHUTDOWN] DB closed cleanly.');
	} catch (e) {
		console.error('[SHUTDOWN] Error closing DB:', e);
	}
	process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
