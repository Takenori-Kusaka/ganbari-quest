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

	if (!fs.existsSync(DB_PATH)) {
		// DB が存在しない場合のみ新規作成
		console.log('[E2E Setup]   No DB found, creating fresh database...');
		execSync('npx drizzle-kit push', { stdio: 'pipe', cwd: process.cwd() });
		console.log('[E2E Setup]   Running seed script...');
		execSync('npx tsx src/lib/server/db/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
	} else {
		console.log('[E2E Setup]   DB exists, ensuring seed data...');
		try {
			execSync('npx tsx src/lib/server/db/seed.ts', { stdio: 'pipe', cwd: process.cwd() });
		} catch {
			console.log('[E2E Setup]   Seed skipped (DB may be locked by dev server, data should exist)');
		}
	}

	// テスト用クリーンアップ: 今日の活動記録を削除（記録テストの安定化）
	try {
		const Database = (await import('better-sqlite3')).default;
		const db = new Database(DB_PATH);
		const deleted = db
			.prepare("DELETE FROM activity_logs WHERE recorded_date = date('now', 'localtime')")
			.run();
		if (deleted.changes > 0) {
			console.log(`[E2E Setup]   Cleaned ${deleted.changes} activity log(s) from today.`);
		}
		db.close();
	} catch {
		console.log('[E2E Setup]   Activity log cleanup skipped (DB may be locked).');
	}

	console.log('[E2E Setup] Database ready.');
}
