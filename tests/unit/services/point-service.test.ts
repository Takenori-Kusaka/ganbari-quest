// tests/unit/services/point-service.test.ts
// ポイント管理サービスのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE categories (
		id INTEGER PRIMARY KEY,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		icon TEXT,
		color TEXT
	);

	INSERT INTO categories VALUES (1, 'undou', 'うんどう', '🏃', '#FF6B6B');
	INSERT INTO categories VALUES (2, 'benkyou', 'べんきょう', '📚', '#4ECDC4');
	INSERT INTO categories VALUES (3, 'seikatsu', 'せいかつ', '🏠', '#FFE66D');
	INSERT INTO categories VALUES (4, 'kouryuu', 'こうりゅう', '🤝', '#A8E6CF');
	INSERT INTO categories VALUES (5, 'souzou', 'そうぞう', '🎨', '#DDA0DD');

	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		active_title_id INTEGER,
		display_config TEXT,
		user_id TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		age_min INTEGER, age_max INTEGER,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'seed',
		grade_level TEXT, subcategory TEXT, description TEXT,
		name_kana TEXT,
		name_kanji TEXT,
		trigger_hint TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		points INTEGER NOT NULL, streak_days INTEGER NOT NULL DEFAULT 1,
		streak_bonus INTEGER NOT NULL DEFAULT 0,
		recorded_date TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		cancelled INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL, type TEXT NOT NULL,
		description TEXT, reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_point_ledger_child ON point_ledger(child_id, created_at);
	CREATE TABLE statuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id), total_xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, peak_xp INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category_id);
	CREATE TABLE status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id), value REAL NOT NULL,
		change_amount REAL NOT NULL, change_type TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE evaluations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		week_start TEXT NOT NULL, week_end TEXT NOT NULL,
		scores_json TEXT NOT NULL, bonus_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE market_benchmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		age INTEGER NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id),
		mean REAL NOT NULL, std_dev REAL NOT NULL,
		source TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category_id);
	CREATE TABLE settings (
		key TEXT PRIMARY KEY, value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE character_images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		type TEXT NOT NULL, file_path TEXT NOT NULL,
		prompt_hash TEXT,
		generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE login_bonuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		login_date TEXT NOT NULL, rank TEXT NOT NULL,
		base_points INTEGER NOT NULL, multiplier REAL NOT NULL DEFAULT 1.0,
		total_points INTEGER NOT NULL, consecutive_days INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_login_bonuses_child_date ON login_bonuses(child_id, login_date);
`;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

import {
	convertPoints,
	getPointBalance,
	getPointHistory,
} from '../../../src/lib/server/services/point-service';

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	testDb = drizzle(sqlite, { schema });
});

afterAll(() => {
	sqlite.close();
});

function resetDb() {
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM children');
	sqlite.exec("DELETE FROM sqlite_sequence WHERE name IN ('children', 'point_ledger')");
}

function seedChild() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

function addPoints(childId: number, amount: number, type: string, description: string) {
	testDb.insert(schema.pointLedger).values({ childId, amount, type, description }).run();
}

describe('point-service', () => {
	beforeEach(() => {
		seedChild();
	});

	// 残高取得
	it('ポイント残高0を返す（初期状態）', async () => {
		const result = await getPointBalance(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.balance).toBe(0);
			expect(result.convertableAmount).toBe(0);
		}
	});

	it('ポイント残高を正しく計算する', async () => {
		addPoints(1, 100, 'activity', 'テスト活動');
		addPoints(1, 200, 'activity', 'テスト活動2');
		addPoints(1, -50, 'cancel', 'キャンセル');

		const result = await getPointBalance(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.balance).toBe(250);
			expect(result.convertableAmount).toBe(0); // 500未満
		}
	});

	it('変換可能額を正しく計算する（500P単位）', async () => {
		addPoints(1, 1250, 'activity', '大量ポイント');

		const result = await getPointBalance(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.balance).toBe(1250);
			expect(result.convertableAmount).toBe(1000); // 500 * 2
		}
	});

	it('存在しない子供のポイント残高はNOT_FOUND', async () => {
		const result = await getPointBalance(999, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// 履歴取得
	it('ポイント履歴を取得する', async () => {
		addPoints(1, 100, 'activity', '活動1');
		addPoints(1, 200, 'activity', '活動2');
		addPoints(1, 50, 'login_bonus', 'ログインボーナス');

		const result = await getPointHistory(1, { limit: 50, offset: 0 }, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			const history = await result.history;
			expect(history.length).toBe(3);
		}
	});

	it('履歴のlimit/offsetが動作する', async () => {
		addPoints(1, 10, 'activity', '1');
		addPoints(1, 20, 'activity', '2');
		addPoints(1, 30, 'activity', '3');

		const result = await getPointHistory(1, { limit: 2, offset: 0 }, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			const history = await result.history;
			expect(history.length).toBe(2);
		}
	});

	it('存在しない子供の履歴はNOT_FOUND', async () => {
		const result = await getPointHistory(999, { limit: 50, offset: 0 }, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// ポイント変換
	it('ポイントを正常に変換できる（500P）', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const result = await convertPoints(1, 500, 'test-tenant', 'preset');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.convertedAmount).toBe(500);
			expect(result.remainingBalance).toBe(200);
		}

		// 残高確認
		const balance = await getPointBalance(1, 'test-tenant');
		if (!('error' in balance)) {
			expect(balance.balance).toBe(200);
		}
	});

	it('残高不足時はINSUFFICIENT_POINTSエラー', async () => {
		addPoints(1, 300, 'activity', 'テスト');

		const result = await convertPoints(1, 500, 'test-tenant', 'preset');
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
	});

	it('存在しない子供の変換はNOT_FOUND', async () => {
		const result = await convertPoints(999, 500, 'test-tenant', 'preset');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('1000P変換が正常に動作する', async () => {
		addPoints(1, 1500, 'activity', '大量');

		const result = await convertPoints(1, 1000, 'test-tenant', 'preset');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.convertedAmount).toBe(1000);
			expect(result.remainingBalance).toBe(500);
		}
	});

	it('変換後に履歴にconvertエントリが追加される', async () => {
		addPoints(1, 600, 'activity', 'テスト');
		await convertPoints(1, 500, 'test-tenant', 'preset');

		const historyResult = await getPointHistory(1, { limit: 50, offset: 0 }, 'test-tenant');
		if (!('error' in historyResult)) {
			const historyList = await historyResult.history;
			const convertEntry = historyList.find((h: { type: string }) => h.type === 'convert');
			expect(convertEntry).toBeDefined();
			expect(convertEntry?.amount).toBe(-500);
		}
	});

	// 自由入力モード
	it('手動入力モードで1P単位の変換ができる', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const result = await convertPoints(1, 123, 'test-tenant', 'manual');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.convertedAmount).toBe(123);
			expect(result.remainingBalance).toBe(577);
			expect(result.message).toContain('手動入力');
		}
	});

	it('領収書モードで変換できる', async () => {
		addPoints(1, 1000, 'activity', 'テスト');

		const result = await convertPoints(1, 648, 'test-tenant', 'receipt');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.convertedAmount).toBe(648);
			expect(result.remainingBalance).toBe(352);
			expect(result.message).toContain('領収書読み取り');
		}
	});

	it('プリセットモード（デフォルト）の説明文にサフィックスがない', async () => {
		addPoints(1, 600, 'activity', 'テスト');

		const result = await convertPoints(1, 500, 'test-tenant', 'preset');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.message).not.toContain('手動入力');
			expect(result.message).not.toContain('領収書');
		}
	});
});
