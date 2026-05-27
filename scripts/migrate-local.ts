// Temporary migration script for local DB schema alignment
//
// NOTE (#2508 / 3 dimension SSOT):
//   shadow-table recreation 系 migration
//   (checklist_templates.kind drop / #2362 PR-3 FK switchover / PR-5 family flip)
//   は `src/lib/server/db/migration/lazy-startup-migrations.ts` に集約済み。
//   本 script は (a) lazy helper を明示的に呼ぶ + (b) `validateAndMigrate` に
//   拾われない or 拾われる前に backfill が必要な軽量 ALTER のみを実行する。
//
//   startup 経路 (`client.ts`) と本 script の両方で同じ helper を共有することで、
//   「migrate-local.ts は最新だが startup は古い」という乖離を構造的に防ぐ。
//
// 実行: `npx tsx scripts/migrate-local.ts` (NUC は startup 時に自動適用されるため通常不要)

import Database from 'better-sqlite3';
import { SQL_CREATE_TABLES } from '../src/lib/server/db/create-tables';
import { applyLazyStartupMigrations } from '../src/lib/server/db/migration/lazy-startup-migrations';

const db = new Database('./data/ganbari-quest.db');
db.pragma('foreign_keys = OFF');

console.log(
	'Applying lazy startup migrations (shadow-table recreation / DROP COLUMN / FK switch)...',
);
applyLazyStartupMigrations(db);

console.log('Running CREATE TABLE IF NOT EXISTS...');
db.exec(SQL_CREATE_TABLES);

// ============================================================
// In-place column additions (ADR-0031 NULL 混在防止対応)
// CREATE TABLE IF NOT EXISTS は既存テーブルを変更しないため、
// 既存 DB に新カラムを追加する場合はここで個別に ALTER TABLE する。
//
// 注: NOT NULL DEFAULT 'literal' の単純追加は `validateAndMigrate` (schema-validator.ts)
//     でも自動適用されるが、本 script は startup 経路を経由しないため明示的に列挙する。
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

// #1755 (#1709-A): activities.priority カラム追加
//   - 'must' = 今日のおやくそく / 'optional' = ふつうの活動（既定）
//   - 注: checklist_templates.kind 列削除 + 'routine' レコード drop は
//     `migration/lazy-startup-migrations.ts` の `migrateChecklistTemplatesDropKind` に集約済み。
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

// #2267 (EPIC #2266): parent_messages に bonus_points / reward_category カラム追加
//   - bonus_points: 応援機能 (cheer) で付与したボーナスポイント (reward_notice タイプのみで使用)
//   - reward_category: 応援機能のカテゴリ (うんどう/べんきょう/せいかつ/こうりゅう/そうぞう/とくべつ)
//   - 既存 stamp / text レコードは NULL のまま (cheer P 付与なしを意味する)
if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parent_messages'")
		.get() &&
	!tableHasColumn('parent_messages', 'bonus_points')
) {
	console.log('Adding parent_messages.bonus_points column (#2267)…');
	db.exec('ALTER TABLE parent_messages ADD COLUMN bonus_points INTEGER;');
	console.log('  → done (existing rows remain NULL = no cheer P)');
}
if (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parent_messages'")
		.get() &&
	!tableHasColumn('parent_messages', 'reward_category')
) {
	console.log('Adding parent_messages.reward_category column (#2267)…');
	db.exec('ALTER TABLE parent_messages ADD COLUMN reward_category TEXT;');
	console.log('  → done (existing rows remain NULL = no category)');
}

// ============================================================
// 注: 以下の shadow-table recreation 系は本 script から削除済み
// (`migration/lazy-startup-migrations.ts` に集約):
//   - #1755 checklist_templates.kind 列削除 + 'routine' レコード drop
//   - #2362 PR-3 activity FK switchover (activities → child_activities)
//   - #2362 PR-5 checklist_templates family master flip
//     (child_id → tenant_id + checklist_template_assignments 作成)
// ============================================================

const tables = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
	.all() as { name: string }[];
console.log('Tables:', tables.map((t) => t.name).join(', '));

db.close();
console.log('Migration complete.');
