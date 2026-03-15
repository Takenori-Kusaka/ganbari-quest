#!/usr/bin/env node
/**
 * #0096 カテゴリIDサロゲートキー化 マイグレーション
 *
 * 既存の本番DBに対して以下を実行:
 * 1. categories マスタテーブルを作成し、5件のマスタデータを投入
 * 2. activities, statuses, status_history, market_benchmarks の
 *    category TEXT → category_id INTEGER 列を追加・データ移行
 * 3. 旧 category TEXT 列を削除（テーブル再作成）
 *
 * 実行前に必ずバックアップを取ること！
 *   node scripts/backup-db.cjs
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'ganbari.db');
console.log(`[migrate-category-ids] DB: ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // テーブル再作成中はFK無効化

const CATEGORY_MAP = {
  'うんどう': 1,
  'べんきょう': 2,
  'せいかつ': 3,
  'こうりゅう': 4,
  'そうぞう': 5,
};

try {
  db.exec('BEGIN TRANSACTION');

  // ============================================================
  // Step 1: categories マスタテーブル作成
  // ============================================================
  const hasCategoriesTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='categories'"
  ).get();

  if (!hasCategoriesTable) {
    console.log('[Step 1] Creating categories master table...');
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT
      );
      INSERT INTO categories VALUES (1, 'undou', 'うんどう', '🏃', '#FF6B6B');
      INSERT INTO categories VALUES (2, 'benkyou', 'べんきょう', '📚', '#4ECDC4');
      INSERT INTO categories VALUES (3, 'seikatsu', 'せいかつ', '🏠', '#FFE66D');
      INSERT INTO categories VALUES (4, 'kouryuu', 'こうりゅう', '🤝', '#A8E6CF');
      INSERT INTO categories VALUES (5, 'souzou', 'そうぞう', '🎨', '#DDA0DD');
    `);
    console.log('  ✓ categories table created with 5 rows');
  } else {
    console.log('[Step 1] categories table already exists, skipping');
  }

  // ============================================================
  // Step 2: activities テーブルの category → category_id 変換
  // ============================================================
  const activitiesCols = db.prepare("PRAGMA table_info('activities')").all();
  const hasOldCategoryCol = activitiesCols.some(c => c.name === 'category');
  const hasNewCategoryIdCol = activitiesCols.some(c => c.name === 'category_id');

  if (hasOldCategoryCol && !hasNewCategoryIdCol) {
    console.log('[Step 2a] Migrating activities.category → category_id...');

    // Add new column
    db.exec('ALTER TABLE activities ADD COLUMN category_id INTEGER');

    // Map data
    for (const [name, id] of Object.entries(CATEGORY_MAP)) {
      const result = db.prepare('UPDATE activities SET category_id = ? WHERE category = ?').run(id, name);
      console.log(`  mapped "${name}" → ${id}: ${result.changes} rows`);
    }

    // Check for unmapped
    const unmapped = db.prepare('SELECT COUNT(*) as cnt FROM activities WHERE category_id IS NULL').get();
    if (unmapped.cnt > 0) {
      console.log(`  ⚠ ${unmapped.cnt} activities have NULL category_id, defaulting to 3 (せいかつ)`);
      db.exec('UPDATE activities SET category_id = 3 WHERE category_id IS NULL');
    }

    // Recreate table without old column
    console.log('  Recreating activities table...');
    db.exec(`
      CREATE TABLE activities_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        icon TEXT NOT NULL,
        base_points INTEGER NOT NULL DEFAULT 5,
        age_min INTEGER,
        age_max INTEGER,
        is_visible INTEGER NOT NULL DEFAULT 1,
        daily_limit INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'seed',
        grade_level TEXT,
        subcategory TEXT,
        description TEXT,
        name_kana TEXT,
        name_kanji TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO activities_new SELECT id, name, category_id, icon, base_points, age_min, age_max,
        is_visible, daily_limit, sort_order, source, grade_level, subcategory, description,
        name_kana, name_kanji, created_at FROM activities;
      DROP TABLE activities;
      ALTER TABLE activities_new RENAME TO activities;
      CREATE INDEX idx_activities_category ON activities(category_id);
    `);
    console.log('  ✓ activities migrated');
  } else if (hasNewCategoryIdCol) {
    console.log('[Step 2a] activities already has category_id, skipping');
  }

  // ============================================================
  // Step 3: statuses テーブルの category → category_id 変換
  // ============================================================
  const statusesCols = db.prepare("PRAGMA table_info('statuses')").all();
  const statusHasOld = statusesCols.some(c => c.name === 'category');
  const statusHasNew = statusesCols.some(c => c.name === 'category_id');

  if (statusHasOld && !statusHasNew) {
    console.log('[Step 3] Migrating statuses.category → category_id...');
    db.exec('ALTER TABLE statuses ADD COLUMN category_id INTEGER');
    for (const [name, id] of Object.entries(CATEGORY_MAP)) {
      db.prepare('UPDATE statuses SET category_id = ? WHERE category = ?').run(id, name);
    }
    db.exec('UPDATE statuses SET category_id = 3 WHERE category_id IS NULL');

    db.exec(`
      CREATE TABLE statuses_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_id INTEGER NOT NULL REFERENCES children(id),
        category_id INTEGER NOT NULL REFERENCES categories(id),
        value REAL NOT NULL DEFAULT 0.0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO statuses_new SELECT id, child_id, category_id, value, updated_at FROM statuses;
      DROP TABLE statuses;
      ALTER TABLE statuses_new RENAME TO statuses;
      CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category_id);
    `);
    console.log('  ✓ statuses migrated');
  } else if (statusHasNew) {
    console.log('[Step 3] statuses already has category_id, skipping');
  }

  // ============================================================
  // Step 4: status_history テーブルの category → category_id 変換
  // ============================================================
  const histCols = db.prepare("PRAGMA table_info('status_history')").all();
  const histHasOld = histCols.some(c => c.name === 'category');
  const histHasNew = histCols.some(c => c.name === 'category_id');

  if (histHasOld && !histHasNew) {
    console.log('[Step 4] Migrating status_history.category → category_id...');
    db.exec('ALTER TABLE status_history ADD COLUMN category_id INTEGER');
    for (const [name, id] of Object.entries(CATEGORY_MAP)) {
      db.prepare('UPDATE status_history SET category_id = ? WHERE category = ?').run(id, name);
    }
    db.exec('UPDATE status_history SET category_id = 3 WHERE category_id IS NULL');

    db.exec(`
      CREATE TABLE status_history_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_id INTEGER NOT NULL REFERENCES children(id),
        category_id INTEGER NOT NULL REFERENCES categories(id),
        value REAL NOT NULL,
        change_amount REAL NOT NULL,
        change_type TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO status_history_new SELECT id, child_id, category_id, value, change_amount, change_type, recorded_at FROM status_history;
      DROP TABLE status_history;
      ALTER TABLE status_history_new RENAME TO status_history;
      CREATE INDEX idx_status_history_child_cat ON status_history(child_id, category_id, recorded_at);
    `);
    console.log('  ✓ status_history migrated');
  } else if (histHasNew) {
    console.log('[Step 4] status_history already has category_id, skipping');
  }

  // ============================================================
  // Step 5: market_benchmarks テーブルの category → category_id 変換
  // ============================================================
  const benchCols = db.prepare("PRAGMA table_info('market_benchmarks')").all();
  const benchHasOld = benchCols.some(c => c.name === 'category');
  const benchHasNew = benchCols.some(c => c.name === 'category_id');

  if (benchHasOld && !benchHasNew) {
    console.log('[Step 5] Migrating market_benchmarks.category → category_id...');
    db.exec('ALTER TABLE market_benchmarks ADD COLUMN category_id INTEGER');
    for (const [name, id] of Object.entries(CATEGORY_MAP)) {
      db.prepare('UPDATE market_benchmarks SET category_id = ? WHERE category = ?').run(id, name);
    }
    db.exec('UPDATE market_benchmarks SET category_id = 3 WHERE category_id IS NULL');

    db.exec(`
      CREATE TABLE market_benchmarks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        age INTEGER NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        mean REAL NOT NULL,
        std_dev REAL NOT NULL,
        source TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO market_benchmarks_new SELECT id, age, category_id, mean, std_dev, source, updated_at FROM market_benchmarks;
      DROP TABLE market_benchmarks;
      ALTER TABLE market_benchmarks_new RENAME TO market_benchmarks;
      CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category_id);
    `);
    console.log('  ✓ market_benchmarks migrated');
  } else if (benchHasNew) {
    console.log('[Step 5] market_benchmarks already has category_id, skipping');
  }

  db.exec('COMMIT');
  console.log('\n[migrate-category-ids] ✅ Migration completed successfully!');

  // WAL checkpoint + VACUUM to rebuild rootpages after table recreation
  console.log('  Running WAL checkpoint + VACUUM...');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  console.log('  ✓ VACUUM completed');

  // Re-enable FK and verify
  db.pragma('foreign_keys = ON');
  const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
  if (fkCheck.length > 0) {
    console.error('⚠ Foreign key violations found:', fkCheck);
  } else {
    console.log('  ✓ Foreign key check passed');
  }

} catch (err) {
  db.exec('ROLLBACK');
  console.error('[migrate-category-ids] ❌ Migration failed, rolled back:', err);
  process.exit(1);
} finally {
  db.close();
}
