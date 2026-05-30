// src/lib/server/db/client.ts
// DB クライアント初期化（better-sqlite3 + Drizzle ORM）
//
// #2648 Phase A Round 12 (Option γ-extended): **lazy DB init pattern** を採用。
//
// 経緯 (Round 1-10 + Round 11 deep research、SSOT: tmp/research-round11-fix-path-product-fit-2026-05-30.md):
//
// Round 10 で確定した真因 H-1 = **SQLite schema cache invalidation 失敗**:
//   - Playwright lifecycle (webServer → globalSetup、公式仕様で変更不可) により
//     preview server が module load 時 (T+0s) に `new Database(DATABASE_URL)` で
//     空の worker DB を open + auto-init し schema cache を空 schema として確立
//   - 4 秒後 (T+4s) globalSetup が template DB を `db.backup()` で worker DB に in-place overwrite
//   - preview server 内の better-sqlite3 connection は backup 後の overwrite を invalidate しない
//     (Bun #1332 類似、Drizzle prepared statement cache 同型問題)
//   - 結果: `SELECT * FROM children` が 0 行を返し E2E test 全 fail
//
// Round 11 deep research で評価した抜本的選択肢 (フレームワーク変更含む):
//   - Cypress / Vitest browser / TestCafe / Playwright dev mode: H-1 を解決しない (別 process 制約同型)
//   - testcontainers / pglite / MSW: NUC SSOT 破壊 or E2E 意味喪失
//   - Option E (workers=1 強制): CI 2x 退行で Pre-PMF dev velocity 毀損
//   - **Option γ-extended (本実装)**: `new Database()` を module load → 1st HTTP request 時に遅延
//     することで H-1 を直接解決、本 product 適合度 5/5
//
// 実装方針:
//   - `_sqlite` / `_db` は lazy singleton として保持 (null から始まる)
//   - `getOrInitDb()` が idempotent な init を担当 (1st 呼び出し時に new Database + schema init)
//   - `db` export は **Proxy で wrap** し、caller が `db.select(...)` 等を呼んだ時点で
//     裏で `getOrInitDb()` が走る → caller (34 file 以上) を全く変更せずに lazy 化を実現
//   - `hooks.server.ts` の handle 1st-request guard で確実に init 発火
//   - production への影響: 1st request の latency が +50-100ms (DB open + schema init)。
//     許容範囲 (Pre-PMF) + rollback = eager init に戻す 1 commit。
//
// 注意:
//   - `rawSqlite` も lazy 化必要 (`api/health/+server.ts` が dynamic import で取得)
//   - `process.on('SIGTERM' / 'SIGINT')` は init 前でも安全に登録 (gracefulShutdown が _sqlite null チェック)

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SQL_CREATE_TABLES } from './create-tables';
import { assertNoDataOrphans, type OrphanReport } from './migration/data-integrity-guards';
import { applyLazyStartupMigrations } from './migration/lazy-startup-migrations';
import * as schema from './schema';
import { validateAndMigrate } from './schema-validator';

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

// ── lazy singleton state ──────────────────────────────────────────────
let _sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

/**
 * better-sqlite3 connection と Drizzle ORM instance を **idempotent に確立**する。
 *
 * 1st 呼び出し時のみ:
 *   1. `new Database(DATABASE_URL)` (module load 時でなく 1st HTTP request 時 = globalSetup 完了後)
 *   2. pragma 設定 (WAL / foreign_keys / busy_timeout / wal_autocheckpoint / synchronous)
 *   3. `applyLazyStartupMigrations` + `SQL_CREATE_TABLES` + `validateAndMigrate`
 *   4. `assertNoDataOrphans` (runtime data orphan gate #2519)
 *
 * 2nd 以降は cached `_db` を即座に return。
 *
 * `hooks.server.ts` の handle 1st-request guard から先頭で呼ぶ + Proxy の trap でも
 * 自動的に呼ばれる (二重防御、idempotent なので無害)。
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: schema 自動初期化フロー (pragma → applyLazyStartupMigrations → SQL_CREATE_TABLES → validateAndMigrate → assertNoDataOrphans の 5 段直列) が長い構造的事情によるもの。旧 eager init 時代から同 complexity (Round 12 で関数化しただけ)、別 Issue でリファクタ予定 (#2648 follow-up)。
export function getOrInitDb(): ReturnType<typeof drizzle> {
	if (_db) return _db;

	// #2648 Round 12 (debug 一時、Round 13 で revert 判断): lazy init の発火 timing を観察。
	// preview server で 1st HTTP request 時に呼ばれることを CI log で実証する。
	// 期待: globalSetup 完了後の 1st request 時 (T+5s 以降) に発火し、children > 0 を返す。
	const DATABASE_URL = process.env.DATABASE_URL ?? './data/ganbari-quest.db';
	console.info(
		`[client.ts/lazy] getOrInitDb called: PID=${process.pid} DATABASE_URL=${DATABASE_URL} cwd=${process.cwd()}`,
	);

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

		// #2648 Round 12 (debug 一時): schema init 完了後の row 数を log。
		// Option γ-extended の効果検証: 期待 children > 0 (globalSetup backup 後の seeded DB を読む)。
		try {
			const childCount = sqlite.prepare('SELECT COUNT(*) AS c FROM children').get() as {
				c: number;
			};
			console.info(
				`[client.ts/lazy] PID=${process.pid} children count after init: ${childCount.c}`,
			);
		} catch (e) {
			console.info(
				`[client.ts/lazy] PID=${process.pid} children count ERROR: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

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

	_sqlite = sqlite;
	_db = drizzle(sqlite, { schema });
	return _db;
}

/**
 * `db` export を **Proxy で wrap** し、初回 property access 時に lazy init を発火させる。
 *
 * これにより既存の 34+ caller (`import { db } from '$lib/server/db/client'`) を一切変更
 * せずに lazy 化が実現できる。Proxy の get trap が `db.select(...)` / `db.insert(...)`
 * 等の 1st 呼び出し時に `getOrInitDb()` を経由する。
 *
 * 注意: drizzle ORM の type は `ReturnType<typeof drizzle>` で、property access が
 * method 含む object pattern のため Proxy が透過的に動作する。
 */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
	get(_target, prop, receiver) {
		const realDb = getOrInitDb();
		const value = Reflect.get(realDb, prop, receiver);
		// method の場合は real instance を this に bind する (Proxy が this を target に向けるのを回避)
		return typeof value === 'function' ? value.bind(realDb) : value;
	},
});

export type DrizzleDatabase = ReturnType<typeof drizzle>;

/**
 * raw sqlite handle. `api/health/+server.ts` 等が `prepare()` を直接呼ぶため Proxy 化。
 * 1st access 時に `getOrInitDb()` 経由で `_sqlite` が確立される。
 */
export const rawSqlite = new Proxy({} as Database.Database, {
	get(_target, prop, receiver) {
		getOrInitDb(); // _sqlite を確立
		if (!_sqlite) throw new Error('[client.ts] rawSqlite access before init (internal bug)');
		const value = Reflect.get(_sqlite, prop, receiver);
		return typeof value === 'function' ? value.bind(_sqlite) : value;
	},
});

// Graceful shutdown: flush WAL and close DB on SIGTERM / SIGINT
function gracefulShutdown(_signal: string) {
	try {
		if (_sqlite) {
			_sqlite.pragma('wal_checkpoint(TRUNCATE)');
			_sqlite.close();
		}
	} catch (e) {
		console.error('[SHUTDOWN] Error closing DB:', e);
	}
	process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
