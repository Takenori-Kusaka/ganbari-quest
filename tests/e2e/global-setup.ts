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

		// skill_nodes / child_skill_nodes / skill_points テーブル（#0174 スキルツリー）
		db.exec(`
			CREATE TABLE IF NOT EXISTS skill_nodes (
				id INTEGER PRIMARY KEY,
				category_id INTEGER REFERENCES categories(id),
				name TEXT NOT NULL,
				description TEXT,
				icon TEXT NOT NULL,
				sort_order INTEGER NOT NULL DEFAULT 0,
				sp_cost INTEGER NOT NULL DEFAULT 1,
				required_node_id INTEGER,
				required_category_level INTEGER NOT NULL DEFAULT 0,
				effect_type TEXT NOT NULL,
				effect_value REAL NOT NULL,
				target_modes TEXT NOT NULL DEFAULT '["lower","upper","teen"]'
			);
			CREATE TABLE IF NOT EXISTS child_skill_nodes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				node_id INTEGER NOT NULL REFERENCES skill_nodes(id),
				unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_child_skill_nodes_unique ON child_skill_nodes(child_id, node_id);
			CREATE TABLE IF NOT EXISTS skill_points (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				child_id INTEGER NOT NULL REFERENCES children(id),
				balance INTEGER NOT NULL DEFAULT 0,
				total_earned INTEGER NOT NULL DEFAULT 0,
				total_spent INTEGER NOT NULL DEFAULT 0,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_points_child ON skill_points(child_id);
		`);

		// スキルノードマスタ挿入
		const skillNodeCount = db.prepare('SELECT count(*) as c FROM skill_nodes').get() as {
			c: number;
		};
		if (skillNodeCount.c === 0) {
			const skillStmt = db.prepare(
				'INSERT OR IGNORE INTO skill_nodes (id, category_id, name, description, icon, sort_order, sp_cost, required_node_id, required_category_level, effect_type, effect_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			);
			const skillData: [
				number,
				number | null,
				string,
				string,
				string,
				number,
				number,
				number | null,
				number,
				string,
				number,
			][] = [
				[
					1,
					1,
					'げんきアップ',
					'うんどうのXPが10%ふえるよ！',
					'💪',
					1,
					1,
					null,
					1,
					'xp_multiplier',
					0.1,
				],
				[2, 1, 'きたえろ', 'うんどうのポイントが+1もらえるよ！', '🏋️', 2, 2, 1, 2, 'point_bonus', 1],
				[
					3,
					1,
					'アスリートのたましい',
					'れんぞくが1日とぎれてもだいじょうぶ！',
					'🔥',
					3,
					3,
					2,
					3,
					'streak_shield',
					1,
				],
				[
					4,
					2,
					'べんきょうブースト',
					'べんきょうのXPが10%ふえるよ！',
					'📖',
					1,
					1,
					null,
					1,
					'xp_multiplier',
					0.1,
				],
				[
					5,
					2,
					'しゅうちゅうりょくアップ',
					'べんきょうのポイントが+2もらえるよ！',
					'🧠',
					2,
					2,
					4,
					2,
					'point_bonus',
					2,
				],
				[
					6,
					2,
					'ちしきのいずみ',
					'べんきょうのXPがさらに25%ふえるよ！',
					'🏛️',
					3,
					3,
					5,
					3,
					'xp_multiplier',
					0.25,
				],
				[
					7,
					3,
					'せいかつブースト',
					'せいかつのXPが10%ふえるよ！',
					'🏡',
					1,
					1,
					null,
					1,
					'xp_multiplier',
					0.1,
				],
				[
					8,
					3,
					'ログインボーナス+',
					'ログインボーナスが+3ポイント！',
					'🎁',
					2,
					2,
					7,
					2,
					'login_bonus',
					3,
				],
				[
					9,
					3,
					'にちじょうのたつじん',
					'ぜんぶのカテゴリのXPが5%ふえるよ！',
					'🌟',
					3,
					3,
					8,
					3,
					'global_xp_multiplier',
					0.05,
				],
				[
					10,
					4,
					'こうりゅうブースト',
					'こうりゅうのXPが10%ふえるよ！',
					'🤝',
					1,
					1,
					null,
					1,
					'xp_multiplier',
					0.1,
				],
				[
					11,
					4,
					'なかよしさん',
					'コンボボーナスが20%アップ！',
					'💕',
					2,
					2,
					10,
					2,
					'combo_bonus',
					0.2,
				],
				[
					12,
					4,
					'みんなのリーダー',
					'こうりゅうのXPがさらに25%ふえるよ！',
					'👑',
					3,
					3,
					11,
					3,
					'xp_multiplier',
					0.25,
				],
				[
					13,
					5,
					'そうぞうブースト',
					'そうぞうのXPが10%ふえるよ！',
					'🎨',
					1,
					1,
					null,
					1,
					'xp_multiplier',
					0.1,
				],
				[
					14,
					5,
					'アイデアマン',
					'そうぞうのポイントが+2もらえるよ！',
					'💡',
					2,
					2,
					13,
					2,
					'point_bonus',
					2,
				],
				[
					15,
					5,
					'クリエイティブマスター',
					'そうぞうのXPがさらに25%ふえるよ！',
					'✨',
					3,
					3,
					14,
					3,
					'xp_multiplier',
					0.25,
				],
				[
					16,
					null,
					'バランスブースト',
					'ぜんぶのカテゴリのXPが5%ふえるよ！',
					'🌈',
					99,
					0,
					null,
					2,
					'global_xp_multiplier',
					0.05,
				],
			];
			for (const row of skillData) {
				skillStmt.run(...row);
			}
			console.log('[E2E Setup]   Created skill node masters (16 nodes).');
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
