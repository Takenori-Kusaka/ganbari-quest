// scripts/backup-db.js - WAL-safe SQLite backup with rotation
// Usage: node scripts/backup-db.js
// Keeps last 10 backups in data/backups/
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'ganbari-quest.db');
const BACKUP_DIR = path.join(DB_DIR, 'backups');
const MAX_BACKUPS = 10;

if (!fs.existsSync(DB_PATH)) {
  console.error('ERROR: Database not found at', DB_PATH);
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const now = new Date();
const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const backupPath = path.join(BACKUP_DIR, `ganbari-quest-${ts}.db`);

const db = new Database(DB_PATH);
db.backup(backupPath)
  .then(() => {
    console.log(`Backup OK: ${backupPath}`);
    db.close();

    // Rotate old backups
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse();

    if (files.length > MAX_BACKUPS) {
      for (const old of files.slice(MAX_BACKUPS)) {
        fs.unlinkSync(path.join(BACKUP_DIR, old));
        console.log(`Removed old backup: ${old}`);
      }
    }

    console.log(`Total backups: ${Math.min(files.length, MAX_BACKUPS)}`);
  })
  .catch(err => {
    console.error('Backup FAILED:', err);
    db.close();
    process.exit(1);
  });
