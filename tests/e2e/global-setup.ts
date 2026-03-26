// tests/e2e/global-setup.ts
// E2E テスト用 DB 確認・クリーンアップスクリプト
// playwright.config.ts の globalSetup から呼ばれる

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve('data/ganbari-quest.db');

export default async function globalSetup() {
	console.log('[E2E Setup] Checking test database...');

	const dir = path.dirname(DB_PATH);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	// DB ファイルが存在してもテーブルがなければスキーマを作り直す（CI で vitest が空 DB を生成するケース対策）
	let needsSchema = !fs.existsSync(DB_PATH);
	if (!needsSchema) {
		try {
			const Database = (await import('better-sqlite3')).default;
			const db = new Database(DB_PATH);
			const table = db
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='children'")
				.get();
			db.close();
			if (!table) needsSchema = true;
		} catch {
			needsSchema = true;
		}
	}

	if (needsSchema) {
		console.log('[E2E Setup]   Creating/rebuilding database schema...');
		execSync('npx drizzle-kit push --force', { stdio: 'pipe', cwd: process.cwd() });
		console.log('[E2E Setup]   Inserting categories...');
		execSync('npx tsx scripts/migrate-local.ts', { stdio: 'pipe', cwd: process.cwd() });
		console.log('[E2E Setup]   Running seed script...');
		execSync('npx tsx src/lib/server/db/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
	} else {
		console.log('[E2E Setup]   DB exists with schema, ensuring seed data...');
		try {
			execSync('npx tsx src/lib/server/db/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
		} catch {
			console.log('[E2E Setup]   Seed skipped (DB may be locked by dev server, data should exist)');
		}
	}

	// E2E テストに必須: テスト用子供の存在確認・作成
	// (#0123: PIN認証廃止 — local モードは認証なし)
	try {
		const Database = (await import('better-sqlite3')).default;
		const db = new Database(DB_PATH);

		// 後方互換: PIN 設定がまだ使われているルートのために残す
		const pinRow = db.prepare("SELECT value FROM settings WHERE key = 'pin_hash'").get() as
			| { value: string }
			| undefined;
		if (!pinRow || !pinRow.value) {
			const bcrypt = (await import('bcrypt')).default;
			const hash = await bcrypt.hash('1234', 10);
			db.prepare(
				"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('pin_hash', ?, datetime('now'))",
			).run(hash);
			for (const key of [
				'session_token',
				'session_expires_at',
				'pin_failed_attempts',
				'pin_locked_until',
			]) {
				db.prepare(
					"INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, '', datetime('now'))",
				).run(key);
			}
			console.log('[E2E Setup]   Created test PIN (1234) for backward compat.');
		}

		// テスト用子供がいなければ作成
		const childCount = db.prepare('SELECT count(*) as c FROM children').get() as { c: number };
		if (childCount.c === 0) {
			db.prepare(
				"INSERT INTO children (nickname, age, theme, ui_mode) VALUES ('ゆうきちゃん', 4, 'pink', 'kinder')",
			).run();
			db.prepare(
				"INSERT INTO children (nickname, age, theme, ui_mode) VALUES ('てすとくん', 1, 'pink', 'baby')",
			).run();

			// ステータス初期化
			for (const childId of [1, 2]) {
				for (const catId of [1, 2, 3, 4, 5]) {
					db.prepare(
						'INSERT OR IGNORE INTO statuses (child_id, category_id, value) VALUES (?, ?, 25.0)',
					).run(childId, catId);
				}
			}
			console.log('[E2E Setup]   Created test children (ゆうきちゃん, てすとくん).');
		}

		// チェックリストテンプレートがなければ作成（チェックリストテストの安定化）
		const kinderChild = db
			.prepare("SELECT id FROM children WHERE ui_mode = 'kinder' LIMIT 1")
			.get() as { id: number } | undefined;
		if (kinderChild) {
			const tmplCount = db
				.prepare('SELECT count(*) as c FROM checklist_templates WHERE child_id = ?')
				.get(kinderChild.id) as { c: number };
			if (tmplCount.c === 0) {
				db.prepare(
					"INSERT INTO checklist_templates (child_id, name, icon, points_per_item, completion_bonus) VALUES (?, 'がっこう', '🏫', 2, 5)",
				).run(kinderChild.id);
				const tmplId = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
				const items: [string, string][] = [
					['ハンカチ', '🤧'],
					['ティッシュ', '🧻'],
					['すいとう', '🧴'],
					['れんらくちょう', '📒'],
				];
				for (const [i, [itemName, itemIcon]] of items.entries()) {
					db.prepare(
						'INSERT INTO checklist_template_items (template_id, name, icon, sort_order) VALUES (?, ?, ?, ?)',
					).run(tmplId, itemName, itemIcon, i);
				}
				console.log('[E2E Setup]   Created checklist template (がっこう).');
			}
		}

		// テスト用クリーンアップ: 今日の活動記録を削除（記録テストの安定化）
		const deleted = db
			.prepare("DELETE FROM activity_logs WHERE recorded_date = date('now', 'localtime')")
			.run();
		if (deleted.changes > 0) {
			console.log(`[E2E Setup]   Cleaned ${deleted.changes} activity log(s) from today.`);
		}

		// 今日のログインボーナスを削除（ログインボーナステストの安定化）
		const deletedBonus = db
			.prepare("DELETE FROM login_bonuses WHERE login_date = date('now', 'localtime')")
			.run();
		if (deletedBonus.changes > 0) {
			console.log(`[E2E Setup]   Cleaned ${deletedBonus.changes} login bonus(es) from today.`);
		}

		db.close();
	} catch (e) {
		console.log('[E2E Setup]   Test data setup error:', e);
	}

	console.log('[E2E Setup] Database ready.');
}
