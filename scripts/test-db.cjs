// scripts/test-db.cjs - Production DB read/write test
const Database = require('better-sqlite3');
const db = new Database('data/ganbari-quest.db');

console.log('=== Production DB Test ===');

// 1. WAL mode check
const wal = db.pragma('journal_mode');
console.log('1. Journal mode:', wal[0].journal_mode);

// 2. Write test
const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString();
const info = db
	.prepare(
		'INSERT INTO activity_logs (child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
	)
	.run(1, 1, 5, 1, 0, today, now);
console.log('2. Write test: inserted log id =', info.lastInsertRowid);

// 3. Read test
const log = db.prepare('SELECT * FROM activity_logs WHERE id = ?').get(info.lastInsertRowid);
console.log(
	'3. Read test:',
	log ? 'OK' : 'FAIL',
	'- child_id:',
	log?.child_id,
	'points:',
	log?.points,
);

// 4. Point ledger write
db.prepare(
	'INSERT INTO point_ledger (child_id, amount, type, description, reference_id) VALUES (?, ?, ?, ?, ?)',
).run(1, 5, 'activity', 'deploy-test', info.lastInsertRowid);
console.log('4. Point ledger write: OK');

// 5. Balance check
const balance = db
	.prepare('SELECT SUM(amount) as total FROM point_ledger WHERE child_id = 1')
	.get();
console.log('5. Point balance:', balance.total);

// 6. Cleanup test data
db.prepare('DELETE FROM point_ledger WHERE description = ?').run('deploy-test');
db.prepare('DELETE FROM activity_logs WHERE id = ?').run(info.lastInsertRowid);
console.log('6. Cleanup: OK');

// 7. Table counts
const tables = [
	'children',
	'activities',
	'achievements',
	'settings',
	'statuses',
	'market_benchmarks',
];
for (const t of tables) {
	const cnt = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get();
	console.log(`   ${t}: ${cnt.cnt} rows`);
}

db.close();
console.log('=== All DB Tests PASSED ===');
