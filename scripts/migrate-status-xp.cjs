#!/usr/bin/env node
// Migration: statuses テーブルを value REAL → totalXp INTEGER, level INTEGER, peakXp INTEGER に移行
// Usage: node scripts/migrate-status-xp.cjs [db-path]
// Default db-path: data/ganbari-quest.db
//
// XP = ポイント統合により、旧 value (0-100スケール) を新 totalXp (XP整数) に変換。
// 変換式: totalXp = Math.round(value * 27)  (DECAY_SCALE=27 で正規化)

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.resolve(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`[migrate-status-xp] Opening database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 99レベルテーブル（status.ts の generateLevelTable と同等）
function generateLevelTable() {
	const keyPoints = [
		[1, 0], [2, 15], [5, 60], [10, 500], [15, 1200],
		[20, 2500], [25, 4200], [30, 6500], [35, 9500],
		[40, 13500], [45, 18500], [50, 24500], [55, 31500],
		[60, 39500], [65, 46500], [70, 52000], [75, 55500],
		[80, 60000], [85, 69000], [90, 86000], [95, 96500],
		[99, 100000],
	];

	function interpolateXp(level) {
		if (level <= 1) return 0;
		for (let i = 0; i < keyPoints.length - 1; i++) {
			const [l1, xp1] = keyPoints[i];
			const [l2, xp2] = keyPoints[i + 1];
			if (level >= l1 && level <= l2) {
				const t = (level - l1) / (l2 - l1);
				return Math.round(xp1 + t * (xp2 - xp1));
			}
		}
		return 100000;
	}

	const table = [];
	for (let lv = 1; lv <= 99; lv++) {
		table.push({ level: lv, requiredXp: interpolateXp(lv) });
	}
	return table;
}

function calcLevelFromXp(totalXp) {
	const table = generateLevelTable();
	const xp = Math.max(0, totalXp);
	let result = table[0];
	for (const entry of table) {
		if (entry.requiredXp <= xp) {
			result = entry;
		} else {
			break;
		}
	}
	return result.level;
}

// カラム存在チェック
const columns = db.pragma('table_info(statuses)');
const columnNames = columns.map((c) => c.name);

const hasValue = columnNames.includes('value');
const hasTotalXp = columnNames.includes('total_xp');
const hasLevel = columnNames.includes('level');
const hasPeakXp = columnNames.includes('peak_xp');

if (hasTotalXp && hasLevel && hasPeakXp && !hasValue) {
	console.log('[migrate-status-xp] Already migrated. Nothing to do.');
	db.close();
	process.exit(0);
}

if (!hasValue && !hasTotalXp) {
	console.error('[migrate-status-xp] ERROR: statuses table has neither "value" nor "total_xp" column.');
	db.close();
	process.exit(1);
}

const DECAY_SCALE = 27;

db.exec('BEGIN TRANSACTION');

try {
	if (hasValue && !hasTotalXp) {
		// 新カラム追加
		console.log('[migrate-status-xp] Adding new columns: total_xp, level, peak_xp');
		db.exec('ALTER TABLE statuses ADD COLUMN total_xp INTEGER NOT NULL DEFAULT 0');
		db.exec('ALTER TABLE statuses ADD COLUMN level INTEGER NOT NULL DEFAULT 1');
		db.exec('ALTER TABLE statuses ADD COLUMN peak_xp INTEGER NOT NULL DEFAULT 0');

		// 既存データを変換
		const rows = db.prepare('SELECT id, value FROM statuses').all();
		console.log(`[migrate-status-xp] Converting ${rows.length} rows...`);

		const updateStmt = db.prepare('UPDATE statuses SET total_xp = ?, level = ?, peak_xp = ? WHERE id = ?');

		for (const row of rows) {
			const totalXp = Math.round((row.value || 0) * DECAY_SCALE);
			const level = calcLevelFromXp(totalXp);
			const peakXp = totalXp; // 現在値をピークとする
			updateStmt.run(totalXp, level, peakXp, row.id);
		}

		console.log(`[migrate-status-xp] Converted ${rows.length} rows.`);
		console.log('[migrate-status-xp] Note: old "value" column is kept for safety. Remove manually after verification.');
	} else if (hasTotalXp) {
		console.log('[migrate-status-xp] total_xp column already exists.');

		// level/peakXp がなければ追加
		if (!hasLevel) {
			console.log('[migrate-status-xp] Adding level column...');
			db.exec('ALTER TABLE statuses ADD COLUMN level INTEGER NOT NULL DEFAULT 1');
		}
		if (!hasPeakXp) {
			console.log('[migrate-status-xp] Adding peak_xp column...');
			db.exec('ALTER TABLE statuses ADD COLUMN peak_xp INTEGER NOT NULL DEFAULT 0');
		}

		// level/peakXp を再計算
		const rows = db.prepare('SELECT id, total_xp FROM statuses').all();
		const updateStmt = db.prepare('UPDATE statuses SET level = ?, peak_xp = ? WHERE id = ?');
		for (const row of rows) {
			const level = calcLevelFromXp(row.total_xp);
			const peakXp = row.total_xp;
			updateStmt.run(level, peakXp, row.id);
		}
		console.log(`[migrate-status-xp] Recalculated level/peak_xp for ${rows.length} rows.`);
	}

	// status_history: value カラムが REAL のまま → XPスケールに変換
	const historyColumns = db.pragma('table_info(status_history)');
	const hasHistoryValue = historyColumns.some((c) => c.name === 'value');

	if (hasHistoryValue) {
		const historyCount = db.prepare('SELECT COUNT(*) as cnt FROM status_history').get();
		if (historyCount.cnt > 0) {
			console.log(`[migrate-status-xp] Scaling status_history values (${historyCount.cnt} rows)...`);
			db.exec(`UPDATE status_history SET value = ROUND(value * ${DECAY_SCALE}), change_amount = ROUND(change_amount * ${DECAY_SCALE})`);
			console.log('[migrate-status-xp] status_history scaled.');
		}
	}

	db.exec('COMMIT');
	console.log('[migrate-status-xp] Migration complete!');
} catch (e) {
	db.exec('ROLLBACK');
	console.error('[migrate-status-xp] Migration FAILED, rolled back:', e.message);
	process.exit(1);
}

// 検証
const sample = db.prepare('SELECT id, total_xp, level, peak_xp FROM statuses LIMIT 5').all();
console.log('[migrate-status-xp] Sample data:');
for (const row of sample) {
	console.log(`  id=${row.id} totalXp=${row.total_xp} level=${row.level} peakXp=${row.peak_xp}`);
}

db.close();
