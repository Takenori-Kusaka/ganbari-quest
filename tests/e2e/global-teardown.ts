// tests/e2e/global-teardown.ts
// E2E テスト後のローカル DB クリーンアップスクリプト
// playwright.config.ts の globalTeardown から呼ばれる

import fs from 'node:fs';
import path from 'node:path';

const databaseUrl = process.env.DATABASE_URL ?? './data/ganbari-quest.db';
const DB_PATH = path.resolve(databaseUrl);

/**
 * E2E テスト用の子供ニックネーム（global-setup.ts と同期）
 * ニックネームベースで ID を動的に解決し、共用 DB 上の本物のユーザーデータを守る。
 */
const E2E_CHILD_NICKNAMES = [
	'たろうくん',
	'はなこちゃん',
	'けんたくん',
	'ゆうこちゃん',
	'まさとくん',
];

export default async function globalTeardown() {
	if (process.env.E2E_SKIP_TEARDOWN === 'true') {
		console.log('[E2E Teardown] E2E_SKIP_TEARDOWN=true — skipping local cleanup.');
		return;
	}

	console.log('[E2E Teardown] Cleaning up test data...');

	if (!fs.existsSync(DB_PATH)) {
		console.log('[E2E Teardown] DB file not found, skipping cleanup.');
		return;
	}

	try {
		const Database = (await import('better-sqlite3')).default;
		const db = new Database(DB_PATH);

		// テスト用子供の ID をニックネームから動的に解決
		const nicknamePlaceholders = E2E_CHILD_NICKNAMES.map(() => '?').join(', ');
		const childRows = db
			.prepare(`SELECT id FROM children WHERE nickname IN (${nicknamePlaceholders})`)
			.all(...E2E_CHILD_NICKNAMES) as { id: number }[];
		const childIds = childRows.map((r) => r.id);

		if (childIds.length === 0) {
			console.log('[E2E Teardown] No test children found, skipping cleanup.');
			db.close();
			return;
		}

		const childIdPlaceholders = childIds.map(() => '?').join(', ');

		// E2E テスト子供の活動ログを削除（日付条件なし — 子供IDでスコープ限定）
		const deletedLogs = db
			.prepare(`DELETE FROM activity_logs WHERE child_id IN (${childIdPlaceholders})`)
			.run(...childIds);
		if (deletedLogs.changes > 0) {
			console.log(`[E2E Teardown]   Cleaned ${deletedLogs.changes} activity log(s).`);
		}

		// E2E テスト子供のログインボーナスを削除
		const deletedBonus = db
			.prepare(`DELETE FROM login_bonuses WHERE child_id IN (${childIdPlaceholders})`)
			.run(...childIds);
		if (deletedBonus.changes > 0) {
			console.log(`[E2E Teardown]   Cleaned ${deletedBonus.changes} login bonus(es).`);
		}

		// E2E テスト子供のピン留め設定を削除
		const deletedPins = db
			.prepare(`DELETE FROM child_activity_preferences WHERE child_id IN (${childIdPlaceholders})`)
			.run(...childIds);
		if (deletedPins.changes > 0) {
			console.log(`[E2E Teardown]   Cleaned ${deletedPins.changes} pin preference(s).`);
		}

		// E2E テスト子供のスタンプエントリを削除
		try {
			const deletedStamps = db
				.prepare(
					`DELETE FROM stamp_entries WHERE card_id IN (
						SELECT id FROM stamp_cards WHERE child_id IN (${childIdPlaceholders})
					)`,
				)
				.run(...childIds);
			if (deletedStamps.changes > 0) {
				console.log(`[E2E Teardown]   Cleaned ${deletedStamps.changes} stamp entry(ies).`);
			}
		} catch {
			// stamp_entries テーブルが存在しない場合は無視
		}

		// セッション情報をクリア（テスト中に作成されたセッション）
		try {
			db.prepare(
				"UPDATE settings SET value = '' WHERE key IN ('session_token', 'session_expires_at')",
			).run();
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
