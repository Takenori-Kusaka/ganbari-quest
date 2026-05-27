// src/lib/server/db/client.ts
// DB クライアント初期化（better-sqlite3 + Drizzle ORM）

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SQL_CREATE_TABLES } from './create-tables';
import { assertNoDataOrphans, type OrphanReport } from './migration/data-integrity-guards';
import { applyLazyStartupMigrations } from './migration/lazy-startup-migrations';
import * as schema from './schema';
import { validateAndMigrate } from './schema-validator';

const DATABASE_URL = process.env.DATABASE_URL ?? './data/ganbari-quest.db';

/**
 * data orphan 検出時の Discord alert 送出 (#2519)。fire-and-forget。
 * `discord-alert.ts` を **dynamic import** して startup module が
 * `$env/dynamic/private` を eager load しないようにする。webhook 未設定環境
 * (dev / CI) では `sendDiscordAlert` 側が no-op で抜ける。
 */
function emitOrphanAlert(report: OrphanReport): void {
	const detail = Object.entries(report.counts)
		.map(([table, count]) => `${table}=${count}`)
		.join(' ');
	import('../discord-alert')
		.then(({ sendDiscordAlert }) =>
			sendDiscordAlert({
				level: 'critical',
				message: `DATA ORPHAN 検出: core 4 table が child_activities(id) を参照できません (合計 ${report.total} 行)`,
				errorSummary: `${detail}\n復旧: docs/runbooks/activities-data-recovery.md`,
			}),
		)
		.catch((err) => {
			console.error('[data-integrity-guard #2519] Discord alert 送出失敗', err);
		});
}

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
	// 1. shadow-table recreation / DROP COLUMN / FK target switchover を最初に実行。
	//    既存 production DB の旧 schema を新 schema 互換に揃え、後続の
	//    `SQL_CREATE_TABLES` の `CREATE INDEX ... ON <new_column>` 等が
	//    `no such column` で fail しないようにする。
	//    詳細: src/lib/server/db/migration/lazy-startup-migrations.ts 冒頭コメント
	applyLazyStartupMigrations(sqlite);

	// 2. 新規 table / index を idempotent に作成
	sqlite.exec(SQL_CREATE_TABLES);

	// 3. スキーマバリデーション + 安全な自動マイグレーション（カラム追加）
	const schemaResult = validateAndMigrate(sqlite);

	if (schemaResult.applied.length > 0) {
		for (const _m of schemaResult.applied) {
		}
	}
	for (const w of schemaResult.warnings) {
		console.warn(`[SCHEMA] ${w}`);
	}

	if (!schemaResult.valid) {
		console.error('[SCHEMA] データベーススキーマが不整合です:');
		for (const err of schemaResult.errors) {
			console.error(`  ✗ ${err}`);
		}
		// SCHEMA_VALIDATION_MODE=warn で起動を継続可能（デバッグ用）
		if (process.env.SCHEMA_VALIDATION_MODE !== 'warn') {
			console.error('[SCHEMA] アプリケーションを停止します。修正後に再デプロイしてください。');
			process.exit(1);
		}
	}

	// 4. runtime data orphan gate (#2519)。dim 4 (data copy migration) の漏れ /
	//    別 backend からの誤った backfill 等で core 4 table が child_activities に
	//    存在しない activity_id を指す orphan 状態 (= UI 表示 0 / history 消失、
	//    Issue #2510 と同型) を startup で必ず検出する。orphan を検出しても起動は
	//    止めず (復旧 script は app 経由で実行するため)、Discord alert で気付かせる。
	assertNoDataOrphans(sqlite, { onOrphan: emitOrphanAlert });
}

export const db = drizzle(sqlite, { schema });
export type DrizzleDatabase = typeof db;

// Expose raw sqlite handle for shutdown checkpoint
export const rawSqlite = sqlite;

// Graceful shutdown: flush WAL and close DB on SIGTERM / SIGINT
function gracefulShutdown(_signal: string) {
	try {
		sqlite.pragma('wal_checkpoint(TRUNCATE)');
		sqlite.close();
	} catch (e) {
		console.error('[SHUTDOWN] Error closing DB:', e);
	}
	process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
