// scripts/backup-db.cjs - WAL-safe SQLite backup with rotation and post-hook
// Usage: node scripts/backup-db.cjs
//
// Environment variables:
//   DATABASE_URL       - Path to SQLite database (default: ./data/ganbari-quest.db)
//   BACKUP_DIR         - Backup destination directory (default: ./data/backups/)
//   BACKUP_RETENTION   - Number of backups to keep (default: 7)
//   BACKUP_POST_HOOK   - Command to run after backup (receives backup path as argument)
//
// Examples:
//   node scripts/backup-db.cjs
//   BACKUP_POST_HOOK="node scripts/hooks/gdrive-upload.cjs" node scripts/backup-db.cjs

const Database = require('better-sqlite3');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Load .env if exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
	const envContent = fs.readFileSync(envPath, 'utf-8');
	for (const line of envContent.split('\n')) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith('#')) {
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx > 0) {
				const key = trimmed.slice(0, eqIdx).trim();
				const val = trimmed.slice(eqIdx + 1).trim();
				if (!process.env[key]) process.env[key] = val;
			}
		}
	}
}

const DB_PATH = process.env.DATABASE_URL
	? path.resolve(process.env.DATABASE_URL)
	: path.join(__dirname, '..', 'data', 'ganbari-quest.db');
const BACKUP_DIR = process.env.BACKUP_DIR
	? path.resolve(process.env.BACKUP_DIR)
	: path.join(path.dirname(DB_PATH), 'backups');
const MAX_BACKUPS = Number(process.env.BACKUP_RETENTION) || 7;
const POST_HOOK = process.env.BACKUP_POST_HOOK || '';

/** バックアップファイル名の prefix。 */
const SQLITE_BACKUP_PREFIX = 'ganbari-quest-';
/** バックアップファイルの拡張子。 */
const SQLITE_BACKUP_EXT = '.db';
/**
 * 「日次バックアップの世代」として数えてよいファイル名の厳密形 (`ganbari-quest-<YYYYMMDDHHMMSS>.db`)。
 *
 * ⚠️ prefix + 拡張子の緩い一致 (`startsWith('ganbari-quest-') && endsWith('.db')`) で世代を
 * 数えてはいけない。同じ BACKUP_DIR には運用中に置かれる **命名規則外のファイル**が同居し得る:
 *
 *   - 手動退避 (`ganbari-quest-manual-pre-hotfix.db`) — 辞書順で `'m'` > 数字のため
 *     `.sort().reverse()` の先頭 (= 最新世代扱い) に恒久的に居座り、保持枠を 1 つ食う。
 *     結果として実バックアップの最古 1 世代が本来より 1 日早く消える。
 *   - 旧命名の残骸 (`ganbari-quest-2026-07-26.db`) — 同じく prefix / 拡張子に一致してしまう。
 *   - 世代を退避したディレクトリ (`ganbari-quest-archive.db`) — 名前だけでは file と区別できず、
 *     削除対象に入ると `unlinkSync` が EISDIR / EPERM で落ちてローテーション自体が停止する。
 *
 * これは PGlite 側 (`src/lib/server/db/pglite/backup.ts` の `PGLITE_BACKUP_FILENAME_PATTERN`)
 * で #3956 の QA 指摘により是正済みの class と同一 (辞書順の向きが違うだけ)。SQLite 側も
 * **本パターンの完全一致 + Dirent の isFile()** の 2 段で世代を決める (#3978)。
 */
const SQLITE_BACKUP_FILENAME_PATTERN = /^ganbari-quest-\d{14}\.db$/;

/**
 * `ganbari-quest-<YYYYMMDDHHMMSS>.db` 形式のファイル名を作る (UTC、辞書順 = 時系列順)。
 *
 * 命名を変えたのに世代判定パターンを追従し忘れると、生成物がローテーション対象から外れて
 * 世代が無限に増える (or 新世代が「世代 0 件」に見える) 形で silent に壊れる。生成側で固定する。
 *
 * @param {Date} now
 * @returns {string}
 */
function buildBackupFilename(now) {
	const ts = now
		.toISOString()
		.replace(/[-:T.Z]/g, '')
		.slice(0, 14);
	const filename = `${SQLITE_BACKUP_PREFIX}${ts}${SQLITE_BACKUP_EXT}`;
	if (!SQLITE_BACKUP_FILENAME_PATTERN.test(filename)) {
		throw new Error(`[backup-db] 生成したファイル名が世代判定パターンに一致しません: ${filename}`);
	}
	return filename;
}

/**
 * ディレクトリ内の **日次バックアップ世代のみ**を新しい順 (辞書順降順 = 新しい順) に返す。
 *
 * @param {string[]} filenames 通常ファイルの名前のみ (ディレクトリは呼び出し側で除外済)
 * @returns {string[]}
 */
function selectBackupGenerations(filenames) {
	return filenames
		.filter((f) => SQLITE_BACKUP_FILENAME_PATTERN.test(f))
		.sort()
		.reverse();
}

async function main() {
	console.log('=== Ganbari Quest Backup ===');
	console.log(`Time: ${new Date().toISOString()}`);
	console.log(`DB: ${DB_PATH}`);
	console.log(`Backup dir: ${BACKUP_DIR}`);
	console.log(`Retention: ${MAX_BACKUPS}`);

	if (!fs.existsSync(DB_PATH)) {
		console.error('ERROR: Database not found at', DB_PATH);
		process.exit(1);
	}

	if (!fs.existsSync(BACKUP_DIR)) {
		fs.mkdirSync(BACKUP_DIR, { recursive: true });
	}

	// Create backup
	const backupFilename = buildBackupFilename(new Date());
	const backupPath = path.join(BACKUP_DIR, backupFilename);

	const db = new Database(DB_PATH);
	try {
		await db.backup(backupPath);
		console.log(`[Backup] OK: ${backupFilename}`);
	} catch (err) {
		console.error('[Backup] FAILED:', err);
		db.close();
		process.exit(1);
	}
	db.close();

	// Verify integrity (#2519: table count → PRAGMA integrity_check + foreign_key_check に格上げ)
	// table 数 > 0 は「file が開ける」程度の確認に過ぎず、page 構造の破損 / FK orphan を
	// 見逃す。GitLab 2017 教訓 (backup の存在 ≠ restore 可能) に従い、backup 直後に
	// integrity_check=ok + foreign_key_check=空 を確認する。
	try {
		const bdb = new Database(backupPath, { readonly: true });
		try {
			const tableCountRow = /** @type {{ cnt: number }} */ (
				bdb.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'").get()
			);
			const tableCount = tableCountRow.cnt;

			const integrity = bdb.pragma('integrity_check');
			const integrityOk =
				Array.isArray(integrity) && integrity.length === 1 && integrity[0].integrity_check === 'ok';
			if (!integrityOk) {
				throw new Error(`integrity_check failed: ${JSON.stringify(integrity)}`);
			}

			const fkViolations = /** @type {unknown[]} */ (bdb.pragma('foreign_key_check'));
			if (!Array.isArray(fkViolations) || fkViolations.length > 0) {
				throw new Error(
					`foreign_key_check found ${fkViolations.length} violation(s): ${JSON.stringify(fkViolations.slice(0, 5))}`,
				);
			}

			console.log(
				`[Backup] Integrity check: OK (${tableCount} tables, integrity_check=ok, foreign_key_check=clean)`,
			);
		} finally {
			bdb.close();
		}
	} catch (err) {
		console.error('[Backup] Integrity check FAILED:', err);
		process.exit(1);
	}

	// Rotate old backups
	// 世代判定は「命名パターンの完全一致」+「通常ファイルであること」の 2 段 (#3978)。
	// 手動退避 / 旧命名の残骸 / 退避ディレクトリを世代に数えないことで、保持世代数と削除対象が
	// 同居物に左右されないようにする。
	const regularFileNames = fs
		.readdirSync(BACKUP_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name);
	const files = selectBackupGenerations(regularFileNames);
	if (files.length > MAX_BACKUPS) {
		for (const old of files.slice(MAX_BACKUPS)) {
			fs.unlinkSync(path.join(BACKUP_DIR, old));
			console.log(`[Rotate] Removed: ${old}`);
		}
	}
	console.log(`[Backup] Total: ${Math.min(files.length, MAX_BACKUPS)} backups`);

	// Execute post-hook
	if (POST_HOOK) {
		try {
			// hook command の file 存在チェック (command の第 2 token = file path 想定)
			const tokens = POST_HOOK.split(' ');
			const hookFile = tokens[1]; // e.g. "node scripts/hooks/gdrive-upload.cjs" → "scripts/hooks/gdrive-upload.cjs"

			// backup-db.cjs の実行ディレクトリに依存せず判定できるよう repoRoot ベースで解決
			const repoRoot = path.join(__dirname, '..');
			if (hookFile && !fs.existsSync(path.resolve(repoRoot, hookFile))) {
				console.warn(
					`[backup-db] WARNING: BACKUP_POST_HOOK file not found: ${hookFile}, skipping hook (backup itself succeeded)`,
				);
			} else {
				console.log(`[Hook] Running: ${POST_HOOK} "${backupPath}"`);
				execSync(`${POST_HOOK} "${backupPath}"`, {
					stdio: 'inherit',
					cwd: repoRoot,
					timeout: 120000,
				});
				console.log('[Hook] OK');
			}
		} catch (err) {
			console.warn(
				`[backup-db] WARNING: BACKUP_POST_HOOK failed: ${err instanceof Error ? err.message : String(err)}, backup itself succeeded`,
			);
			// Hook failure is non-fatal - local backup is already saved
		}
	}

	console.log('=== Backup complete ===');
}

module.exports = {
	SQLITE_BACKUP_FILENAME_PATTERN,
	buildBackupFilename,
	selectBackupGenerations,
};

// CJS の直接実行判定。require.main / module はいずれも realpath 解決済みのため
// symlink / junction 経由で起動しても一致する (ESM 側の判定 SSOT は scripts/lib/is-main.mjs)。
if (require.main === module) {
	main().catch((err) => {
		console.error('Fatal error:', err);
		process.exit(1);
	});
}
