// tests/unit/services/point-service.test.ts
// ポイント管理サービスのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL, category TEXT NOT NULL, icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		age_min INTEGER, age_max INTEGER,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
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
		category TEXT NOT NULL, value REAL NOT NULL DEFAULT 0.0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category);
	CREATE TABLE status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category TEXT NOT NULL, value REAL NOT NULL,
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
		age INTEGER NOT NULL, category TEXT NOT NULL,
		mean REAL NOT NULL, std_dev REAL NOT NULL,
		source TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category);
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
	getPointBalance,
	getPointHistory,
	convertPoints,
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
	testDb.insert(schema.children)
		.values({ nickname: 'テストちゃん', age: 4, theme: 'pink' })
		.run();
}

function addPoints(childId: number, amount: number, type: string, description: string) {
	testDb.insert(schema.pointLedger)
		.values({ childId, amount, type, description })
		.run();
}

describe('point-service', () => {
	beforeEach(() => {
		seedChild();
	});

	// 残高取得
	it('ポイント残高0を返す（初期状態）', () => {
		const result = getPointBalance(1);
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.balance).toBe(0);
			expect(result.convertableAmount).toBe(0);
		}
	});

	it('ポイント残高を正しく計算する', () => {
		addPoints(1, 100, 'activity', 'テスト活動');
		addPoints(1, 200, 'activity', 'テスト活動2');
		addPoints(1, -50, 'cancel', 'キャンセル');

		const result = getPointBalance(1);
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.balance).toBe(250);
			expect(result.convertableAmount).toBe(0); // 500未満
		}
	});

	it('変換可能額を正しく計算する（500P単位）', () => {
		addPoints(1, 1250, 'activity', '大量ポイント');

		const result = getPointBalance(1);
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.balance).toBe(1250);
			expect(result.convertableAmount).toBe(1000); // 500 * 2
		}
	});

	it('存在しない子供のポイント残高はNOT_FOUND', () => {
		const result = getPointBalance(999);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// 履歴取得
	it('ポイント履歴を取得する', () => {
		addPoints(1, 100, 'activity', '活動1');
		addPoints(1, 200, 'activity', '活動2');
		addPoints(1, 50, 'login_bonus', 'ログインボーナス');

		const result = getPointHistory(1, { limit: 50, offset: 0 });
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.history.length).toBe(3);
		}
	});

	it('履歴のlimit/offsetが動作する', () => {
		addPoints(1, 10, 'activity', '1');
		addPoints(1, 20, 'activity', '2');
		addPoints(1, 30, 'activity', '3');

		const result = getPointHistory(1, { limit: 2, offset: 0 });
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.history.length).toBe(2);
		}
	});

	it('存在しない子供の履歴はNOT_FOUND', () => {
		const result = getPointHistory(999, { limit: 50, offset: 0 });
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// ポイント変換
	it('ポイントを正常に変換できる（500P）', () => {
		addPoints(1, 700, 'activity', 'テスト');

		const result = convertPoints(1, 500);
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.convertedAmount).toBe(500);
			expect(result.remainingBalance).toBe(200);
		}

		// 残高確認
		const balance = getPointBalance(1);
		if (!('error' in balance)) {
			expect(balance.balance).toBe(200);
		}
	});

	it('残高不足時はINSUFFICIENT_POINTSエラー', () => {
		addPoints(1, 300, 'activity', 'テスト');

		const result = convertPoints(1, 500);
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
	});

	it('存在しない子供の変換はNOT_FOUND', () => {
		const result = convertPoints(999, 500);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('1000P変換が正常に動作する', () => {
		addPoints(1, 1500, 'activity', '大量');

		const result = convertPoints(1, 1000);
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.convertedAmount).toBe(1000);
			expect(result.remainingBalance).toBe(500);
		}
	});

	it('変換後に履歴にconvertエントリが追加される', () => {
		addPoints(1, 600, 'activity', 'テスト');
		convertPoints(1, 500);

		const history = getPointHistory(1, { limit: 50, offset: 0 });
		if (!('error' in history)) {
			const convertEntry = history.history.find((h) => h.type === 'convert');
			expect(convertEntry).toBeDefined();
			expect(convertEntry!.amount).toBe(-500);
		}
	});
});
