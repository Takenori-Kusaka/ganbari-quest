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
			// is_main_quest カラム追加マイグレーション (#549)
			try {
				db.exec('ALTER TABLE activities ADD COLUMN is_main_quest INTEGER NOT NULL DEFAULT 0');
				console.log('[E2E Setup]   Added is_main_quest column to activities.');
			} catch {
				// カラムが既に存在する場合は無視
			}

			// #783: is_archived + archived_reason カラム追加マイグレーション
			for (const table of ['children', 'activities', 'checklist_templates']) {
				try {
					db.exec(`ALTER TABLE ${table} ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`);
					console.log(`[E2E Setup]   Added is_archived column to ${table}.`);
				} catch {
					// カラムが既に存在する場合は無視
				}
				try {
					db.exec(`ALTER TABLE ${table} ADD COLUMN archived_reason TEXT`);
					console.log(`[E2E Setup]   Added archived_reason column to ${table}.`);
				} catch {
					// カラムが既に存在する場合は無視
				}
			}

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

		// #839: PremiumWelcome ダイアログ抑制
		// local モードでは plan=family（有料）になるため、premium_welcome_shown が
		// 未設定だとウェルカムダイアログが表示され他テストの FAB クリック等をブロックする。
		// premium-welcome.spec.ts は cognito-dev モードで独立実行されるため影響なし。
		db.prepare(
			"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('premium_welcome_shown', 'true', datetime('now'))",
		).run();
		console.log('[E2E Setup]   Suppressed PremiumWelcome dialog (premium_welcome_shown=true).');

		// テスト用子供を冪等に作成（nickname ベースの存在チェック）
		const TEST_CHILDREN = [
			{ nickname: 'たろうくん', age: 4, theme: 'pink', ui_mode: 'preschool' },
			{ nickname: 'はなこちゃん', age: 1, theme: 'pink', ui_mode: 'baby' },
			{ nickname: 'けんたくん', age: 8, theme: 'blue', ui_mode: 'elementary' },
			{ nickname: 'ゆうこちゃん', age: 13, theme: 'green', ui_mode: 'junior' },
			{ nickname: 'まさとくん', age: 16, theme: 'purple', ui_mode: 'senior' },
		];
		for (const child of TEST_CHILDREN) {
			const existing = db
				.prepare('SELECT id FROM children WHERE nickname = ?')
				.get(child.nickname) as { id: number } | undefined;
			if (!existing) {
				db.prepare('INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, ?, ?, ?)').run(
					child.nickname,
					child.age,
					child.theme,
					child.ui_mode,
				);
				console.log(`[E2E Setup]   Created test child: ${child.nickname} (${child.ui_mode})`);
			}
		}
		// テスト用子供の ID マップ（以降の処理で使用）
		const testChildIds: Record<string, number> = {};
		for (const child of TEST_CHILDREN) {
			const row = db.prepare('SELECT id FROM children WHERE nickname = ?').get(child.nickname) as {
				id: number;
			};
			testChildIds[child.nickname] = row.id;
		}

		// ステータス初期化（カテゴリごとにリアルなレベル差をつける — INSERT OR IGNORE で冪等）
		const statusData: Record<string, [number, number, number][]> = {
			// [categoryId, totalXp, level]
			// たろうくん (preschool): せいかつが得意、べんきょうはこれから
			たろうくん: [
				[1, 80, 4], // undou: よく体を動かす
				[2, 30, 2], // benkyou: まだこれから
				[3, 150, 6], // seikatsu: 生活習慣が一番得意
				[4, 60, 3], // kouryuu: お友達と遊べる
				[5, 45, 3], // souzou: おえかき好き
			],
			// はなこちゃん (baby): 全体的にまだ低レベル
			はなこちゃん: [
				[1, 20, 2], // undou
				[2, 10, 1], // benkyou
				[3, 35, 2], // seikatsu
				[4, 15, 1], // kouryuu
				[5, 10, 1], // souzou
			],
			// けんたくん (elementary): うんどうとべんきょうがバランス良い
			けんたくん: [
				[1, 200, 8], // undou: スポーツクラブ
				[2, 180, 7], // benkyou: 授業で頑張る
				[3, 120, 5], // seikatsu: 自分でできる
				[4, 100, 5], // kouryuu: 友達と協力
				[5, 90, 4], // souzou: 図工が好き
			],
			// ゆうこちゃん (junior): べんきょう重視、部活でうんどう
			ゆうこちゃん: [
				[1, 150, 6], // undou: 部活で運動
				[2, 300, 10], // benkyou: 受験勉強で高レベル
				[3, 100, 5], // seikatsu: 自立している
				[4, 130, 6], // kouryuu: 部活の仲間
				[5, 70, 4], // souzou: 美術部ではないが趣味で
			],
			// まさとくん (senior): 全体的に高レベル
			まさとくん: [
				[1, 250, 9], // undou: 部活のエース
				[2, 350, 11], // benkyou: 大学受験に向けて
				[3, 180, 7], // seikatsu: 完全に自立
				[4, 200, 8], // kouryuu: リーダーシップ
				[5, 120, 5], // souzou: 趣味で創作
			],
		};
		for (const [nickname, xpData] of Object.entries(statusData)) {
			const childId = testChildIds[nickname];
			for (const [catId, xp, lv] of xpData) {
				db.prepare(
					'INSERT OR IGNORE INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (?, ?, ?, ?, ?)',
				).run(childId, catId, xp, lv, xp);
			}
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
				"INSERT INTO checklist_templates (child_id, name, icon, points_per_item, completion_bonus, time_slot) VALUES (?, 'あさのしたく', '☀️', 2, 5, 'morning')",
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
				"INSERT INTO checklist_templates (child_id, name, icon, points_per_item, completion_bonus, time_slot) VALUES (?, 'よるのじゅんび', '🌙', 2, 5, 'evening')",
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
				stripe_subscription_id TEXT,
				upgrade_reason TEXT,
				trial_start_source TEXT,
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

			CREATE TABLE IF NOT EXISTS daily_battles (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				enemy_id INTEGER NOT NULL,
				date TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				outcome TEXT,
				reward_points INTEGER NOT NULL DEFAULT 0,
				turns_used INTEGER NOT NULL DEFAULT 0,
				player_stats_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_battles_child_date
				ON daily_battles(child_id, date);
			CREATE INDEX IF NOT EXISTS idx_daily_battles_child
				ON daily_battles(child_id);

			CREATE TABLE IF NOT EXISTS enemy_collection (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				enemy_id INTEGER NOT NULL,
				first_defeated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				defeat_count INTEGER NOT NULL DEFAULT 1
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_enemy_collection_child_enemy
				ON enemy_collection(child_id, enemy_id);
			CREATE INDEX IF NOT EXISTS idx_enemy_collection_child
				ON enemy_collection(child_id);


			CREATE TABLE IF NOT EXISTS license_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				event_type TEXT NOT NULL,
				license_key TEXT NOT NULL,
				tenant_id TEXT,
				actor_id TEXT,
				ip TEXT,
				ua TEXT,
				metadata TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_license_events_key
				ON license_events(license_key, created_at);
			CREATE INDEX IF NOT EXISTS idx_license_events_type_created
				ON license_events(event_type, created_at);
			CREATE INDEX IF NOT EXISTS idx_license_events_tenant
				ON license_events(tenant_id);
			CREATE INDEX IF NOT EXISTS idx_license_events_ip_created
				ON license_events(ip, created_at);

		`);

		// リアルな過去の活動ログを追加（ステータス画面・レーダーチャートの表示用）
		// 今日のログはテスト安定化のため下で削除されるが、過去日のログは保持
		const pastLogCount = db
			.prepare(
				"SELECT count(*) as c FROM activity_logs WHERE recorded_date < date('now', 'localtime')",
			)
			.get() as { c: number };
		if (pastLogCount.c === 0) {
			// たろうくん の過去7日分の活動ログ
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
							testChildIds.たろうくん,
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

			// はなこちゃん の過去5日分
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
							testChildIds.はなこちゃん,
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

			// けんたくん の過去6日分の活動ログ
			const elementaryActivities = db
				.prepare(
					"SELECT id, name, category_id, base_points FROM activities WHERE grade_level = 'elementary_lower' OR (age_min <= 8 AND (age_max IS NULL OR age_max >= 8)) LIMIT 20",
				)
				.all() as { id: number; name: string; category_id: number; base_points: number }[];

			if (elementaryActivities.length > 0) {
				const logStmt3 = db.prepare(
					'INSERT INTO activity_logs (child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
				);
				for (let daysAgo = 6; daysAgo >= 1; daysAgo--) {
					const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
					const dateStr = date.toISOString().split('T')[0];
					const logsPerDay = 2 + (daysAgo % 2); // 2-3件/日
					for (let j = 0; j < logsPerDay && j < elementaryActivities.length; j++) {
						const act = elementaryActivities[(daysAgo * 2 + j) % elementaryActivities.length];
						if (!act) continue;
						const streak = 7 - daysAgo;
						const bonus = streak > 1 ? Math.floor(act.base_points * 0.1 * (streak - 1)) : 0;
						logStmt3.run(
							testChildIds.けんたくん,
							act.id,
							act.base_points + bonus,
							streak,
							bonus,
							dateStr,
							`${dateStr}T15:${String(j * 10).padStart(2, '0')}:00.000Z`,
						);
					}
				}
				console.log('[E2E Setup]   Added realistic activity logs for けんたくん (6 days).');
			}

			// ゆうこちゃん の過去5日分の活動ログ
			const juniorActivities = db
				.prepare(
					"SELECT id, name, category_id, base_points FROM activities WHERE grade_level = 'middle_school' OR (age_min <= 13 AND (age_max IS NULL OR age_max >= 13)) LIMIT 20",
				)
				.all() as { id: number; name: string; category_id: number; base_points: number }[];

			if (juniorActivities.length > 0) {
				const logStmt4 = db.prepare(
					'INSERT INTO activity_logs (child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
				);
				for (let daysAgo = 5; daysAgo >= 1; daysAgo--) {
					const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
					const dateStr = date.toISOString().split('T')[0];
					const logsPerDay = 2 + (daysAgo % 3); // 2-4件/日
					for (let j = 0; j < logsPerDay && j < juniorActivities.length; j++) {
						const act = juniorActivities[(daysAgo * 3 + j) % juniorActivities.length];
						if (!act) continue;
						const streak = 6 - daysAgo;
						const bonus = streak > 1 ? Math.floor(act.base_points * 0.1 * (streak - 1)) : 0;
						logStmt4.run(
							testChildIds.ゆうこちゃん,
							act.id,
							act.base_points + bonus,
							streak,
							bonus,
							dateStr,
							`${dateStr}T17:${String(j * 10).padStart(2, '0')}:00.000Z`,
						);
					}
				}
				console.log('[E2E Setup]   Added realistic activity logs for ゆうこちゃん (5 days).');
			}

			// まさとくん の過去4日分の活動ログ
			const seniorActivities = db
				.prepare(
					"SELECT id, name, category_id, base_points FROM activities WHERE grade_level = 'high_school' OR (age_min <= 16 AND (age_max IS NULL OR age_max >= 16)) LIMIT 20",
				)
				.all() as { id: number; name: string; category_id: number; base_points: number }[];

			if (seniorActivities.length > 0) {
				const logStmt5 = db.prepare(
					'INSERT INTO activity_logs (child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
				);
				for (let daysAgo = 4; daysAgo >= 1; daysAgo--) {
					const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
					const dateStr = date.toISOString().split('T')[0];
					const logsPerDay = 1 + (daysAgo % 2); // 1-2件/日
					for (let j = 0; j < logsPerDay && j < seniorActivities.length; j++) {
						const act = seniorActivities[(daysAgo * 2 + j) % seniorActivities.length];
						if (!act) continue;
						const streak = 5 - daysAgo;
						const bonus = streak > 1 ? Math.floor(act.base_points * 0.1 * (streak - 1)) : 0;
						logStmt5.run(
							testChildIds.まさとくん,
							act.id,
							act.base_points + bonus,
							streak,
							bonus,
							dateStr,
							`${dateStr}T18:${String(j * 15).padStart(2, '0')}:00.000Z`,
						);
					}
				}
				console.log('[E2E Setup]   Added realistic activity logs for まさとくん (4 days).');
			}
		}

		// テスト用クリーンアップ: ピン留め設定を削除（ピン留めテストの安定化）
		const deletedPins = db.prepare('DELETE FROM child_activity_preferences').run();
		if (deletedPins.changes > 0) {
			console.log(`[E2E Setup]   Cleaned ${deletedPins.changes} pin preference(s).`);
		}

		// テスト用クリーンアップ: 今日のバトルを削除（バトルテストの安定化）
		const deletedBattles = db
			.prepare("DELETE FROM daily_battles WHERE date = date('now', 'localtime')")
			.run();
		if (deletedBattles.changes > 0) {
			console.log(`[E2E Setup]   Cleaned ${deletedBattles.changes} daily battle(s) from today.`);
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

		// #752: トライアル E2E 用 — dev-tenant-trial-expired に期限切れトライアル履歴をシード
		const existingTrialExpired = db
			.prepare(
				"SELECT count(*) as c FROM trial_history WHERE tenant_id = 'dev-tenant-trial-expired'",
			)
			.get() as { c: number };
		if (existingTrialExpired.c === 0) {
			const pastEnd = new Date();
			pastEnd.setDate(pastEnd.getDate() - 3);
			const pastStart = new Date();
			pastStart.setDate(pastStart.getDate() - 10);
			db.prepare(
				'INSERT INTO trial_history (tenant_id, start_date, end_date, tier, source) VALUES (?, ?, ?, ?, ?)',
			).run(
				'dev-tenant-trial-expired',
				pastStart.toISOString().split('T')[0],
				pastEnd.toISOString().split('T')[0],
				'standard',
				'user_initiated',
			);
			console.log('[E2E Setup]   Seeded expired trial for dev-tenant-trial-expired.');
		}

		// #752: dev-tenant-free のトライアル履歴をクリーン（テスト開始前に未使用状態にする）
		const cleanedTrialFree = db
			.prepare("DELETE FROM trial_history WHERE tenant_id = 'dev-tenant-free'")
			.run();
		if (cleanedTrialFree.changes > 0) {
			console.log(
				`[E2E Setup]   Cleaned ${cleanedTrialFree.changes} trial record(s) for dev-tenant-free.`,
			);
		}

		// is_main_quest カラム追加マイグレーション (#549)
		try {
			db.exec('ALTER TABLE activities ADD COLUMN is_main_quest INTEGER NOT NULL DEFAULT 0');
			console.log('[E2E Setup]   Added is_main_quest column to activities.');
		} catch {
			// カラムが既に存在する場合は無視
		}

		db.close();
	} catch (e) {
		console.log('[E2E Setup]   Test data setup error:', e);
	}

	console.log('[E2E Setup] Database ready.');
}
