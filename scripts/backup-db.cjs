// scripts/backup-db.cjs - WAL-safe SQLite backup with rotation and post-hook
// Usage: node scripts/backup-db.cjs
//
// Environment variables:
//   DATABASE_URL       - Path to SQLite database (default: ./data/ganbari-quest.db)
//   BACKUP_DIR         - Backup destination directory (default: ./data/backups/)
//   BACKUP_RETENTION   - Number of backups to keep (default: 10)
//   BACKUP_POST_HOOK   - Command to run after backup (receives backup path as argument)
//
// Examples:
//   node scripts/backup-db.cjs
//   BACKUP_POST_HOOK="node scripts/hooks/gdrive-upload.cjs" node scripts/backup-db.cjs

const Database = require('better-sqlite3');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
const MAX_BACKUPS = Number(process.env.BACKUP_RETENTION) || 10;
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
  const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
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

  // Verify integrity
  try {
    const bdb = new Database(backupPath, { readonly: true });
    const result = bdb.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'").get();
    bdb.close();
    console.log(`[Backup] Integrity check: OK (${result.cnt} tables)`);
  } catch (err) {
    console.error('[Backup] Integrity check FAILED:', err);
    process.exit(1);
  }

  // Rotate old backups
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('ganbari-quest-') && f.endsWith('.db'))
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
    console.log(`[Hook] Running: ${POST_HOOK} "${backupPath}"`);
    try {
      execSync(`${POST_HOOK} "${backupPath}"`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
        timeout: 120000,
      });
      console.log('[Hook] OK');
    } catch (err) {
      console.error('[Hook] FAILED:', err.message);
      // Hook failure is non-fatal - local backup is already saved
    }
  }

  console.log('=== Backup complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
