// scripts/fix-activity-logs-index.cjs
// activity_logs の UNIQUE INDEX を通常 INDEX に変更するマイグレーション
// dailyLimit 機能（複数回記録可能な活動）と UNIQUE 制約が矛盾していたため修正
//
// 使い方: node scripts/fix-activity-logs-index.cjs [db-path]
// 例: node scripts/fix-activity-logs-index.cjs data/ganbari-quest.db

const Database = require('better-sqlite3');
const dbPath = process.argv[2] || './data/ganbari-quest.db';

console.log(`[Migration] Opening database: ${dbPath}`);
const db = new Database(dbPath);

// 現在のインデックスを確認
const indexes = db
	.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='activity_logs'")
	.all();
console.log('[Migration] Current activity_logs indexes:');
for (const idx of indexes) {
	console.log(`  - ${idx.name}: ${idx.sql || '(auto)'}`);
}

// UNIQUE INDEX が存在する場合のみ修正
const hasUniqueIndex = indexes.some((idx) => idx.name === 'idx_activity_logs_unique_daily');
if (hasUniqueIndex) {
	console.log('[Migration] Dropping UNIQUE INDEX idx_activity_logs_unique_daily...');
	db.exec('DROP INDEX IF EXISTS idx_activity_logs_unique_daily');

	console.log('[Migration] Creating regular INDEX idx_activity_logs_daily...');
	db.exec(
		'CREATE INDEX IF NOT EXISTS idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date)',
	);

	console.log('[Migration] Done! UNIQUE constraint removed.');
} else {
	const hasRegularIndex = indexes.some((idx) => idx.name === 'idx_activity_logs_daily');
	if (hasRegularIndex) {
		console.log('[Migration] Regular index already exists. No changes needed.');
	} else {
		console.log('[Migration] Creating regular INDEX idx_activity_logs_daily...');
		db.exec(
			'CREATE INDEX IF NOT EXISTS idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date)',
		);
		console.log('[Migration] Done!');
	}
}

// 結果確認
const updatedIndexes = db
	.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='activity_logs'")
	.all();
console.log('[Migration] Updated activity_logs indexes:');
for (const idx of updatedIndexes) {
	console.log(`  - ${idx.name}: ${idx.sql || '(auto)'}`);
}

db.close();
console.log('[Migration] Complete.');
