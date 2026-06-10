// scripts/snapshot-prod-db.cjs — 本番 DB の online snapshot を staging DB path にコピー (#2872)
//
// Usage:
//   node scripts/snapshot-prod-db.cjs --source <prodDb> --dest <stagingDb>
//   node scripts/snapshot-prod-db.cjs --help
//
// NUC staging container を「直近本番 DB snapshot から起動」させるための前段スクリプト。
// 本番稼働中でも一貫した snapshot を better-sqlite3 の online backup (`db.backup()`) で取り、
// dest (staging DB path) にコピーする。staging container はこの dest から起動し、
// `applyLazyStartupMigrations` (src/lib/server/db/migration/lazy-startup-migrations.ts) を
// 貫通させることで「過去状態からマイグレーション込み実機起動」を実機担保する (#2872 AC6 / G-MIG)。
//
// ## 本番不変条件 (#2872 AC4 厳守)
//
//   - source (本番 DB) は **read のみ**。online backup は source を変更しない。
//   - 本番 container を停止しない / 本番 DB に write しない。
//   - dest (staging DB) のみ作成・上書きする。
//
// ## source 不在時の fixture fallback
//
//   本番 DB (source) が存在しない場合 (CI / 初回 provision / staging working-dir 未配線) は
//   exit 0 + 「fixture fallback」を stdout で通知して正常終了する。staging container は
//   この場合 fresh DB (空) で起動し、lazy migration が初期 schema を構築する。
//   これにより staging deploy workflow を本番 DB 不在でもブロックしない (advisory 整合)。
//
// ## 既存 backup 機構の流用 (#1442 使い捨て script 禁止整合)
//
//   online backup ロジックは scripts/backup-db.cjs / scripts/verify-backup-restore.cjs と
//   同じ better-sqlite3 `db.backup()` パターンを採用 (新規 backup 機構を再実装しない)。
//   本 script は「backup-dir への rotation backup」ではなく「指定 dest への 1-shot snapshot」を
//   担う点のみ異なる generic ツール。

const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');

const USAGE = `snapshot-prod-db.cjs — 本番 DB の online snapshot を staging DB path にコピー (#2872)

Usage:
  node scripts/snapshot-prod-db.cjs --source <prodDb> --dest <stagingDb>
  node scripts/snapshot-prod-db.cjs --help

Options:
  --source <path>   本番 (snapshot 元) SQLite DB path。read のみ。不在時は fixture fallback で exit 0。
  --dest   <path>   staging (snapshot 先) SQLite DB path。作成 / 上書きされる。
  --help            この help を表示。

挙動:
  - source 存在時: better-sqlite3 online backup (db.backup) で source → dest に一貫 snapshot。
                   source は read のみで write しない (本番不変条件 #2872 AC4)。
  - source 不在時: exit 0 + "fixture fallback" を stdout 通知。staging は fresh DB で起動 (lazy migration)。
`;

/**
 * argv を最小 parse する (--source / --dest / --help)。
 * 値が等号区切り (--source=x) でも空白区切り (--source x) でも受理する。
 *
 * @param {string[]} argv
 * @returns {{ source: string, dest: string, help: boolean }}
 */
function parseArgs(argv) {
	let source = '';
	let dest = '';
	let help = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			help = true;
		} else if (arg === '--source') {
			source = argv[++i] ?? '';
		} else if (arg.startsWith('--source=')) {
			source = arg.slice('--source='.length);
		} else if (arg === '--dest') {
			dest = argv[++i] ?? '';
		} else if (arg.startsWith('--dest=')) {
			dest = arg.slice('--dest='.length);
		}
	}
	return { source, dest, help };
}

async function main() {
	const { source, dest, help } = parseArgs(process.argv.slice(2));

	if (help) {
		console.log(USAGE);
		process.exit(0);
	}

	if (!dest) {
		console.error('[snapshot] ERROR: --dest <stagingDb> is required.');
		console.error(USAGE);
		process.exit(1);
	}

	console.log('=== Ganbari Quest Prod→Staging DB Snapshot (#2872) ===');
	console.log(`Time:   ${new Date().toISOString()}`);
	console.log(`Source: ${source || '(not provided)'}`);
	console.log(`Dest:   ${dest}`);

	// source 不在 (未指定 or file が無い) → fixture fallback で正常終了。
	// 本番 DB を直接使わず、staging は fresh DB から lazy migration で起動する (#2872 AC6 fallback)。
	if (!source || !fs.existsSync(source)) {
		console.log('[snapshot] source DB not found → fixture fallback.');
		console.log(
			'[snapshot] staging container will start from a fresh DB; applyLazyStartupMigrations builds the initial schema.',
		);
		console.log('=== Snapshot skipped (fixture fallback) ===');
		process.exit(0);
	}

	// dest の親ディレクトリを確保。
	const destDir = path.dirname(path.resolve(dest));
	if (!fs.existsSync(destDir)) {
		fs.mkdirSync(destDir, { recursive: true });
	}

	// online backup: source を read-only で開き、db.backup(dest) で一貫 snapshot を取る。
	// WAL 稼働中でも整合 snapshot が得られる (better-sqlite3 backup API)。source へ write しない。
	const db = new Database(source, { readonly: true });
	try {
		await db.backup(dest);
		console.log(`[snapshot] OK: online backup written to ${dest}`);
	} catch (err) {
		console.error('[snapshot] FAILED:', err instanceof Error ? err.message : String(err));
		db.close();
		process.exit(1);
	}
	db.close();

	// snapshot の最小健全性確認 (open できる + integrity_check=ok)。
	// 本番不変条件のため source ではなく dest (snapshot) のみ検査する。
	try {
		const sdb = new Database(dest, { readonly: true });
		try {
			const integrity = sdb.pragma('integrity_check');
			const integrityOk =
				Array.isArray(integrity) && integrity.length === 1 && integrity[0].integrity_check === 'ok';
			if (!integrityOk) {
				throw new Error(`integrity_check failed: ${JSON.stringify(integrity)}`);
			}
			console.log('[snapshot] PRAGMA integrity_check: ok');
		} finally {
			sdb.close();
		}
	} catch (err) {
		console.error(
			'[snapshot] snapshot integrity check FAILED:',
			err instanceof Error ? err.message : String(err),
		);
		process.exit(1);
	}

	console.log('=== Snapshot complete ===');
	process.exit(0);
}

module.exports = { parseArgs };

if (require.main === module) {
	main().catch((err) => {
		console.error('[snapshot] Fatal error:', err);
		process.exit(1);
	});
}
