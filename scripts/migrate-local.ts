// Temporary migration script for local DB schema alignment
import Database from 'better-sqlite3';
import { SQL_CREATE_TABLES } from '../src/lib/server/db/create-tables';

const db = new Database('./data/ganbari-quest.db');
db.pragma('foreign_keys = OFF');

console.log('Running CREATE TABLE IF NOT EXISTS...');
db.exec(SQL_CREATE_TABLES);

// ============================================================
// In-place column additions (ADR-0031 NULL 混在防止対応)
// CREATE TABLE IF NOT EXISTS は既存テーブルを変更しないため、
// 既存 DB に新カラムを追加する場合はここで個別に ALTER TABLE する。
// ============================================================

interface ColumnInfo {
	name: string;
}

function tableHasColumn(table: string, column: string): boolean {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
	return cols.some((c) => c.name === column);
}

// #1593 (ADR-0023 I6): push_subscriptions.subscriber_role を追加
if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'")
		.get() &&
	!tableHasColumn('push_subscriptions', 'subscriber_role')
) {
	console.log('Adding push_subscriptions.subscriber_role column (#1593)…');
	db.exec(`
		ALTER TABLE push_subscriptions ADD COLUMN subscriber_role TEXT NOT NULL DEFAULT 'parent';
		UPDATE push_subscriptions SET subscriber_role = 'parent' WHERE subscriber_role IS NULL OR subscriber_role = '';
	`);
	console.log('  → done');
}

// #1755 (#1709-A): activities.priority カラム追加 + checklist_templates.kind 列削除
//   - 'must' = 今日のおやくそく / 'optional' = ふつうの活動（既定）
//   - kind 列削除は破壊的変更（ADR-0010 Pre-PMF 利用者ゼロ前提）
//   - 既存 kind='routine' レコードは drop（持ち物純化、旧 routine は priority='must' に役割移管）
if (
	db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activities'").get() &&
	!tableHasColumn('activities', 'priority')
) {
	console.log('Adding activities.priority column (#1755 / #1709-A)…');
	db.exec(`
		ALTER TABLE activities ADD COLUMN priority TEXT NOT NULL DEFAULT 'optional';
		UPDATE activities SET priority = 'optional' WHERE priority IS NULL OR priority = '';
	`);
	console.log('  → done (existing rows backfilled to optional)');
}

if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='checklist_templates'")
		.get() &&
	tableHasColumn('checklist_templates', 'kind')
) {
	console.log('Dropping checklist_templates.kind column (#1755 / #1709-A)…');
	// 旧 kind='routine' のテンプレートを先に削除（持ち物純化）
	const droppedRoutines = db
		.prepare("DELETE FROM checklist_templates WHERE kind = 'routine'")
		.run();
	console.log(`  → deleted ${droppedRoutines.changes} legacy 'routine' templates`);
	// SQLite 3.35+ は ALTER TABLE DROP COLUMN を直接サポート
	db.exec('ALTER TABLE checklist_templates DROP COLUMN kind;');
	console.log('  → kind column dropped');
}

const tables = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
	.all() as { name: string }[];
console.log('Tables:', tables.map((t) => t.name).join(', '));

db.close();
console.log('Migration complete.');
