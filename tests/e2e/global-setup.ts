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
		if (!pinRow?.value) {
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
				"INSERT INTO children (nickname, age, theme, ui_mode) VALUES ('たろうくん', 4, 'pink', 'preschool')",
			).run();
			db.prepare(
				"INSERT INTO children (nickname, age, theme, ui_mode) VALUES ('はなこちゃん', 1, 'pink', 'baby')",
			).run();

			// ステータス初期化（カテゴリごとにリアルなレベル差をつける）
			// たろうくん (preschool): せいかつが得意、べんきょうはこれから
			const kinderXp: [number, number, number][] = [
				// [categoryId, totalXp, level]
				[1, 80, 4], // undou: よく体を動かす
				[2, 30, 2], // benkyou: まだこれから
				[3, 150, 6], // seikatsu: 生活習慣が一番得意
				[4, 60, 3], // kouryuu: お友達と遊べる
				[5, 45, 3], // souzou: おえかき好き
			];
			for (const [catId, xp, lv] of kinderXp) {
				db.prepare(
					'INSERT OR IGNORE INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, ?, ?, ?, ?)',
				).run(catId, xp, lv, xp);
			}
			// はなこちゃん (baby): 全体的にまだ低レベル
			const babyXp: [number, number, number][] = [
				[1, 20, 2], // undou
				[2, 10, 1], // benkyou
				[3, 35, 2], // seikatsu
				[4, 15, 1], // kouryuu
				[5, 10, 1], // souzou
			];
			for (const [catId, xp, lv] of babyXp) {
				db.prepare(
					'INSERT OR IGNORE INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (2, ?, ?, ?, ?)',
				).run(catId, xp, lv, xp);
			}
			console.log('[E2E Setup]   Created test children (たろうくん, はなこちゃん).');
		}

		// フォーカスモード開始日を過去に設定（3日経過 → フォーカスモード無効化）
		// テスト環境ではカテゴリ一覧が見える通常モードが必要
		const allTestChildren = db.prepare('SELECT id FROM children').all() as { id: number }[];
		for (const child of allTestChildren) {
			const key = `focus_mode_start_${child.id}`;
			const past = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
			db.prepare(
				'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
			).run(key, past);
		}

		// チェックリストテンプレート作成（デフォルトプリセット準拠）
		const kinderChild = db
			.prepare("SELECT id FROM children WHERE ui_mode = 'preschool' LIMIT 1")
			.get() as { id: number } | undefined;
		if (kinderChild) {
			// 旧テンプレートをクリーンアップして最新プリセットで再作成
			const existingTmpls = db
				.prepare('SELECT id FROM checklist_templates WHERE child_id = ?')
				.all(kinderChild.id) as { id: number }[];
			for (const t of existingTmpls) {
				db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').run(t.id);
			}
			db.prepare('DELETE FROM checklist_templates WHERE child_id = ?').run(kinderChild.id);

			// あさのしたくプリセット（static/checklist-presets/morning-routine.json 準拠）
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, icon, points_per_item, completion_bonus) VALUES (?, 'あさのしたく', '☀️', 2, 5)",
			).run(kinderChild.id);
			const morningId = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
			const morningItems: [string, string][] = [
				['はみがき', '🪥'],
				['かおをあらう', '🧼'],
				['きがえ', '👕'],
				['あさごはん', '🍚'],
				['もちものチェック', '🎒'],
			];
			for (const [i, [itemName, itemIcon]] of morningItems.entries()) {
				db.prepare(
					'INSERT INTO checklist_template_items (template_id, name, icon, sort_order) VALUES (?, ?, ?, ?)',
				).run(morningId, itemName, itemIcon, i + 1);
			}

			// よるのじゅんびプリセット（static/checklist-presets/evening-routine.json 準拠）
			db.prepare(
				"INSERT INTO checklist_templates (child_id, name, icon, points_per_item, completion_bonus) VALUES (?, 'よるのじゅんび', '🌙', 2, 5)",
			).run(kinderChild.id);
			const eveningId = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
			const eveningItems: [string, string][] = [
				['おふろ', '🛁'],
				['はみがき', '🪥'],
				['あしたのじゅんび', '📋'],
				['おやすみのあいさつ', '😴'],
			];
			for (const [i, [itemName, itemIcon]] of eveningItems.entries()) {
				db.prepare(
					'INSERT INTO checklist_template_items (template_id, name, icon, sort_order) VALUES (?, ?, ?, ?)',
				).run(eveningId, itemName, itemIcon, i + 1);
			}
			console.log('[E2E Setup]   Created checklist templates (あさのしたく, よるのじゅんび).');
		}

		// child_activity_preferences テーブルが存在しなければ作成（#0115 ピン留め機能）
		db.exec(`
			CREATE TABLE IF NOT EXISTS child_activity_preferences (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
				activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
				is_pinned INTEGER NOT NULL DEFAULT 0,
				pin_order INTEGER,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_child_activity_prefs_unique ON child_activity_preferences(child_id, activity_id);
			CREATE INDEX IF NOT EXISTS idx_child_activity_prefs_child ON child_activity_preferences(child_id);
			CREATE INDEX IF NOT EXISTS idx_child_activity_prefs_pinned ON child_activity_preferences(child_id, is_pinned);
		`);

		// activity_mastery テーブル（#0175 活動個別習熟レベルシステム）
		db.exec(`
			CREATE TABLE IF NOT EXISTS activity_mastery (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				activity_id INTEGER NOT NULL REFERENCES activities(id),
				total_count INTEGER NOT NULL DEFAULT 0,
				level INTEGER NOT NULL DEFAULT 1,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_mastery_child_activity ON activity_mastery(child_id, activity_id);
		`);

		// stamp_masters / stamp_cards / stamp_entries テーブル（#0204 スタンプカード）
		db.exec(`
			CREATE TABLE IF NOT EXISTS stamp_masters (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				emoji TEXT NOT NULL,
				rarity TEXT NOT NULL,
				is_default INTEGER NOT NULL DEFAULT 1,
				is_enabled INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS stamp_cards (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
				week_start TEXT NOT NULL,
				week_end TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'collecting',
				redeemed_points INTEGER,
				redeemed_at TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_cards_child_week ON stamp_cards(child_id, week_start);
			CREATE INDEX IF NOT EXISTS idx_stamp_cards_child ON stamp_cards(child_id);
			CREATE TABLE IF NOT EXISTS stamp_entries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				card_id INTEGER NOT NULL REFERENCES stamp_cards(id) ON DELETE CASCADE,
				stamp_master_id INTEGER NOT NULL REFERENCES stamp_masters(id),
				slot INTEGER NOT NULL,
				login_date TEXT NOT NULL,
				earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_entries_card_slot ON stamp_entries(card_id, slot);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_entries_card_date ON stamp_entries(card_id, login_date);
		`);

		// デフォルトスタンプマスタの挿入
		const stampCount = db.prepare('SELECT count(*) as c FROM stamp_masters').get() as { c: number };
		if (stampCount.c === 0) {
			const defaultStamps = [
				['にこにこ', '😊', 'N'],
				['グッジョブ', '👍', 'N'],
				['スター', '⭐', 'N'],
				['ハート', '❤️', 'N'],
				['がんばった', '💪', 'N'],
				['ロケット', '🚀', 'R'],
				['おうかん', '👑', 'R'],
				['トロフィー', '🏆', 'R'],
				['にじ', '🌈', 'R'],
				['たいよう', '☀️', 'R'],
				['ドラゴン', '🐉', 'SR'],
				['ユニコーン', '🦄', 'SR'],
				['たからばこ', '📦', 'SR'],
				['まほうのつえ', '🪄', 'SR'],
				['でんせつのけん', '⚔️', 'UR'],
				['きせきのほし', '🌟', 'UR'],
			];
			const stmt = db.prepare('INSERT INTO stamp_masters (name, emoji, rarity) VALUES (?, ?, ?)');
			for (const [name, emoji, rarity] of defaultStamps) {
				stmt.run(name, emoji, rarity);
			}
			console.log('[E2E Setup]   Created default stamp masters.');
		}

		// child_custom_voices テーブル（#0157 親の声カスタム音声）
		db.exec(`
			CREATE TABLE IF NOT EXISTS child_custom_voices (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL,
				scene TEXT NOT NULL DEFAULT 'complete',
				label TEXT NOT NULL,
				file_path TEXT NOT NULL,
				public_url TEXT NOT NULL,
				duration_ms INTEGER,
				is_active INTEGER NOT NULL DEFAULT 0,
				tenant_id TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_child_custom_voices_child ON child_custom_voices(child_id, scene);
		`);

		// sibling_challenges テーブル（#0216 きょうだいチャレンジ）
		db.exec(`
			CREATE TABLE IF NOT EXISTS sibling_challenges (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				title TEXT NOT NULL,
				description TEXT,
				challenge_type TEXT NOT NULL DEFAULT 'cooperative',
				period_type TEXT NOT NULL DEFAULT 'weekly',
				start_date TEXT NOT NULL,
				end_date TEXT NOT NULL,
				target_config TEXT NOT NULL,
				reward_config TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'active',
				is_active INTEGER NOT NULL DEFAULT 1,
				tenant_id TEXT NOT NULL DEFAULT 'default',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_sibling_challenges_status ON sibling_challenges(status);
			CREATE INDEX IF NOT EXISTS idx_sibling_challenges_dates ON sibling_challenges(start_date, end_date);
		`);

		db.exec(`
			CREATE TABLE IF NOT EXISTS sibling_challenge_progress (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				challenge_id INTEGER NOT NULL REFERENCES sibling_challenges(id) ON DELETE CASCADE,
				child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
				current_value INTEGER NOT NULL DEFAULT 0,
				target_value INTEGER NOT NULL,
				completed INTEGER NOT NULL DEFAULT 0,
				completed_at TEXT,
				reward_claimed INTEGER NOT NULL DEFAULT 0,
				reward_claimed_at TEXT,
				progress_json TEXT,
				tenant_id TEXT NOT NULL DEFAULT 'default',
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_scp_challenge_child ON sibling_challenge_progress(challenge_id, child_id);
			CREATE INDEX IF NOT EXISTS idx_scp_child ON sibling_challenge_progress(child_id);
		`);

		// sibling_cheers テーブル（#0216 きょうだいスタンプ）
		db.exec(`
			CREATE TABLE IF NOT EXISTS sibling_cheers (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				from_child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
				to_child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
				stamp_code TEXT NOT NULL,
				tenant_id TEXT NOT NULL DEFAULT 'default',
				sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				shown_at TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_sibling_cheers_to_shown ON sibling_cheers(to_child_id, shown_at);
		`);

		// push_subscriptions + notification_logs テーブル（#0218 プッシュ通知基盤）
		db.exec(`
			CREATE TABLE IF NOT EXISTS push_subscriptions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tenant_id TEXT NOT NULL,
				endpoint TEXT NOT NULL UNIQUE,
				keys_p256dh TEXT NOT NULL,
				keys_auth TEXT NOT NULL,
				user_agent TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON push_subscriptions(tenant_id);

			CREATE TABLE IF NOT EXISTS notification_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tenant_id TEXT NOT NULL,
				notification_type TEXT NOT NULL,
				title TEXT NOT NULL,
				body TEXT NOT NULL,
				sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				success INTEGER NOT NULL DEFAULT 1,
				error_message TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_date ON notification_logs(tenant_id, sent_at);

			CREATE TABLE IF NOT EXISTS certificates (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				tenant_id TEXT NOT NULL,
				certificate_type TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT,
				issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				metadata TEXT,
				UNIQUE(child_id, tenant_id, certificate_type)
			);
			CREATE INDEX IF NOT EXISTS idx_certificates_child ON certificates(child_id, tenant_id);

			CREATE TABLE IF NOT EXISTS custom_achievements (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tenant_id TEXT NOT NULL,
				child_id INTEGER NOT NULL REFERENCES children(id),
				name TEXT NOT NULL,
				description TEXT,
				icon TEXT NOT NULL DEFAULT '🏅',
				condition_type TEXT NOT NULL,
				condition_activity_id INTEGER,
				condition_category_id INTEGER,
				condition_value INTEGER NOT NULL,
				bonus_points INTEGER NOT NULL DEFAULT 100,
				unlocked_at TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_custom_achievements_tenant_child
				ON custom_achievements(tenant_id, child_id);

			CREATE TABLE IF NOT EXISTS trial_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tenant_id TEXT NOT NULL,
				start_date TEXT NOT NULL,
				end_date TEXT NOT NULL,
				tier TEXT NOT NULL DEFAULT 'standard',
				source TEXT NOT NULL,
				campaign_id TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_trial_history_tenant
				ON trial_history(tenant_id);

			CREATE TABLE IF NOT EXISTS viewer_tokens (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tenant_id TEXT NOT NULL,
				token TEXT NOT NULL UNIQUE,
				label TEXT,
				expires_at TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				revoked_at TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_viewer_tokens_tenant
				ON viewer_tokens(tenant_id);

		`);

		// リアルな過去の活動ログを追加（ステータス画面・レーダーチャートの表示用）
		// 今日のログはテスト安定化のため下で削除されるが、過去日のログは保持
		const pastLogCount = db
			.prepare(
				"SELECT count(*) as c FROM activity_logs WHERE recorded_date < date('now', 'localtime')",
			)
			.get() as { c: number };
		if (pastLogCount.c === 0) {
			// たろうくん (child_id=1) の過去7日分の活動ログ
			// kinder-starter パックの活動を使用（seed.ts の活動名と一致）
			const kinderActivities = db
				.prepare(
					"SELECT id, name, category_id, base_points FROM activities WHERE grade_level = 'kinder' OR (age_min <= 4 AND (age_max IS NULL OR age_max >= 4)) LIMIT 20",
				)
				.all() as { id: number; name: string; category_id: number; base_points: number }[];

			if (kinderActivities.length > 0) {
				const logStmt = db.prepare(
					'INSERT INTO activity_logs (child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
				);
				// 過去7日分（1日2-4件ずつ）
				for (let daysAgo = 7; daysAgo >= 1; daysAgo--) {
					const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
					const dateStr = date.toISOString().split('T')[0];
					const logsPerDay = 2 + (daysAgo % 3); // 2-4件/日
					for (let j = 0; j < logsPerDay && j < kinderActivities.length; j++) {
						const act = kinderActivities[(daysAgo * 3 + j) % kinderActivities.length];
						if (!act) continue;
						const streak = 8 - daysAgo; // 連続日数
						const bonus = streak > 1 ? Math.floor(act.base_points * 0.1 * (streak - 1)) : 0;
						logStmt.run(
							1,
							act.id,
							act.base_points + bonus,
							streak,
							bonus,
							dateStr,
							`${dateStr}T09:${String(j * 15).padStart(2, '0')}:00.000Z`,
						);
					}
				}
				console.log('[E2E Setup]   Added realistic activity logs for たろうくん (7 days).');
			}

			// はなこちゃん (child_id=2) の過去5日分
			const babyActivities = db
				.prepare(
					"SELECT id, name, category_id, base_points FROM activities WHERE grade_level = 'baby' OR (age_min <= 1 AND (age_max IS NULL OR age_max >= 1)) LIMIT 10",
				)
				.all() as { id: number; name: string; category_id: number; base_points: number }[];

			if (babyActivities.length > 0) {
				const logStmt2 = db.prepare(
					'INSERT INTO activity_logs (child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
				);
				for (let daysAgo = 5; daysAgo >= 1; daysAgo--) {
					const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
					const dateStr = date.toISOString().split('T')[0];
					const logsPerDay = 1 + (daysAgo % 2); // 1-2件/日
					for (let j = 0; j < logsPerDay && j < babyActivities.length; j++) {
						const act = babyActivities[(daysAgo * 2 + j) % babyActivities.length];
						if (!act) continue;
						logStmt2.run(
							1 + 1,
							act.id,
							act.base_points,
							1,
							0,
							dateStr,
							`${dateStr}T10:${String(j * 20).padStart(2, '0')}:00.000Z`,
						);
					}
				}
				console.log('[E2E Setup]   Added realistic activity logs for はなこちゃん (5 days).');
			}
		}

		// テスト用クリーンアップ: ピン留め設定を削除（ピン留めテストの安定化）
		const deletedPins = db.prepare('DELETE FROM child_activity_preferences').run();
		if (deletedPins.changes > 0) {
			console.log(`[E2E Setup]   Cleaned ${deletedPins.changes} pin preference(s).`);
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
