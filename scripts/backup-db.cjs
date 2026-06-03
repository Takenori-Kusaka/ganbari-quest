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
	const now = new Date();
	const ts = now
		.toISOString()
		.replace(/[-:T.Z]/g, '')
		.slice(0, 14);
	const backupFilename = `ganbari-quest-${ts}.db`;
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
			const tableCount = bdb
				.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'")
				.get().cnt;

			const integrity = bdb.pragma('integrity_check');
			const integrityOk =
				Array.isArray(integrity) && integrity.length === 1 && integrity[0].integrity_check === 'ok';
			if (!integrityOk) {
				throw new Error(`integrity_check failed: ${JSON.stringify(integrity)}`);
			}

			const fkViolations = bdb.pragma('foreign_key_check');
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
	const files = fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => f.startsWith('ganbari-quest-') && f.endsWith('.db'))
		.sort()
		.reverse();
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
				`[backup-db] WARNING: BACKUP_POST_HOOK failed: ${err.message}, backup itself succeeded`,
			);
			// Hook failure is non-fatal - local backup is already saved
		}
	}

	console.log('=== Backup complete ===');
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
