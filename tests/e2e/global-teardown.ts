// tests/e2e/global-teardown.ts
// E2E テスト後のローカル DB クリーンアップスクリプト
// playwright.config.ts の globalTeardown から呼ばれる

import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve('data/ganbari-quest.db');

export default async function globalTeardown() {
	console.log('[E2E Teardown] Cleaning up test data...');

	if (!fs.existsSync(DB_PATH)) {
		console.log('[E2E Teardown] DB file not found, skipping cleanup.');
		return;
	}

	try {
		const Database = (await import('better-sqlite3')).default;
		const db = new Database(DB_PATH);

		// 今日の活動ログを削除（テスト実行で作成されたもの）
		const deletedLogs = db
			.prepare("DELETE FROM activity_logs WHERE recorded_date = date('now', 'localtime')")
			.run();
		if (deletedLogs.changes > 0) {
			console.log(`[E2E Teardown]   Cleaned ${deletedLogs.changes} activity log(s) from today.`);
		}

		// 今日のログインボーナスを削除
		const deletedBonus = db
			.prepare("DELETE FROM login_bonuses WHERE login_date = date('now', 'localtime')")
			.run();
		if (deletedBonus.changes > 0) {
			console.log(`[E2E Teardown]   Cleaned ${deletedBonus.changes} login bonus(es) from today.`);
		}

		// ピン留め設定を削除
		const deletedPins = db.prepare('DELETE FROM child_activity_preferences').run();
		if (deletedPins.changes > 0) {
			console.log(`[E2E Teardown]   Cleaned ${deletedPins.changes} pin preference(s).`);
		}

		// 今日のスタンプエントリを削除
		try {
			const deletedStamps = db
				.prepare("DELETE FROM stamp_entries WHERE login_date = date('now', 'localtime')")
				.run();
			if (deletedStamps.changes > 0) {
				console.log(
					`[E2E Teardown]   Cleaned ${deletedStamps.changes} stamp entry(ies) from today.`,
				);
			}
		} catch {
			// stamp_entries テーブルが存在しない場合は無視
		}

		// セッション情報をクリア（テスト中に作成されたセッション）
		try {
			db.prepare("UPDATE settings SET value = '' WHERE key IN ('session_token', 'session_expires_at')").run();
		} catch {
			// settings テーブルに該当行がない場合は無視
		}

		db.close();
		console.log('[E2E Teardown] Cleanup complete.');
	} catch (e) {
		// Teardown の失敗はテスト結果に影響させない
		console.log('[E2E Teardown] Cleanup error (non-fatal):', e);
	}
}
