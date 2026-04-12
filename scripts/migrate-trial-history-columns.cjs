#!/usr/bin/env node
// Migration: trial_history テーブルにコンバージョン分析用カラムを追加 (#769)
// Usage: node scripts/migrate-trial-history-columns.cjs [db-path]
// Default db-path: data/ganbari-quest.db
//
// 追加カラム（全て NULL 許容、既存レコードは NULL のまま）:
// - stripe_subscription_id: トライアル後に本契約移行した Stripe subscription ID
// - upgrade_reason: コンバージョン理由 ('auto' / 'manual' / 'email_cta')
// - trial_start_source: トライアル開始トリガー ('/pricing' / '/admin/license' / 'signup_param')

const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2] || path.resolve(__dirname, '..', 'data', 'ganbari-quest.db');
console.log(`[migrate-trial-history-columns] Opening database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const columns = [
	{ name: 'stripe_subscription_id', type: 'TEXT' },
	{ name: 'upgrade_reason', type: 'TEXT' },
	{ name: 'trial_start_source', type: 'TEXT' },
];

let added = 0;
let skipped = 0;

for (const col of columns) {
	// カラムが既に存在するかチェック
	const info = db.pragma(`table_info(trial_history)`);
	const exists = info.some((c) => c.name === col.name);

	if (exists) {
		console.log(`  [skip] ${col.name} already exists`);
		skipped++;
		continue;
	}

	db.exec(`ALTER TABLE trial_history ADD COLUMN ${col.name} ${col.type}`);
	console.log(`  [add] ${col.name} ${col.type}`);
	added++;
}

console.log(
	`[migrate-trial-history-columns] Done: ${added} column(s) added, ${skipped} skipped`,
);

db.close();
