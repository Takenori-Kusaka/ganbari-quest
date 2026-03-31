// tests/unit/services/status-service.test.ts
// ステータスサービスのユニットテスト（新XPスケール対応）

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
	CREATE INDEX idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date);
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
		category_id INTEGER NOT NULL REFERENCES categories(id),
		total_xp INTEGER NOT NULL DEFAULT 0,
		level INTEGER NOT NULL DEFAULT 1,
		peak_xp INTEGER NOT NULL DEFAULT 0,
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
	CREATE INDEX idx_status_history_child_cat ON status_history(child_id, category_id, recorded_at);
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

	CREATE TABLE IF NOT EXISTS level_titles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL,
		level INTEGER NOT NULL,
		custom_title TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_level_titles_tenant_level ON level_titles(tenant_id, level);
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

import { getChildStatus, updateStatus } from '../../../src/lib/server/services/status-service';

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
	sqlite.exec('DELETE FROM status_history');
	sqlite.exec('DELETE FROM statuses');
	sqlite.exec('DELETE FROM market_benchmarks');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children', 'statuses', 'status_history', 'market_benchmarks')",
	);
}

function seedChild() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

function seedBenchmarks() {
	for (const catId of [1, 2, 3, 4, 5]) {
		testDb
			.insert(schema.marketBenchmarks)
			.values({ age: 4, categoryId: catId, mean: 200, stdDev: 50, source: 'test' })
			.run();
	}
}

describe('status-service', () => {
	beforeEach(() => {
		seedChild();
	});

	it('存在しない子供はNOT_FOUND', async () => {
		const result = await getChildStatus(999, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('初期状態で全カテゴリXP=0のステータスを返す', async () => {
		const result = await getChildStatus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.childId).toBe(1);
			expect(result.level).toBe(1); // highestCategoryLevel
			expect(Object.keys(result.statuses).length).toBe(5);
			expect(result.statuses[1]?.value).toBe(0);
			expect(result.statuses[1]?.level).toBe(1);
			expect(result.statuses[1]?.levelTitle).toBe('はじめのぼうけんしゃ');
			expect(result.statuses[1]?.expToNextLevel).toBe(15); // Lv.2 requires 15 XP
		}
	});

	it('ベンチマークなしの場合、偏差値50・星3を返す', async () => {
		const result = await getChildStatus(1, 'test-tenant');
		if (!('error' in result)) {
			expect(result.statuses[1]?.deviationScore).toBe(50);
			expect(result.statuses[1]?.stars).toBe(3);
		}
	});

	it('ベンチマークありの場合、偏差値を正しく計算する', async () => {
		seedBenchmarks();
		// うんどう = 300 XP, mean = 200, stdDev = 50 → 偏差値 (300-200)/50*10+50 = 70
		await updateStatus(1, 1, 300, 'test', 'test-tenant');

		const result = await getChildStatus(1, 'test-tenant');
		if (!('error' in result)) {
			expect(result.statuses[1]?.value).toBe(300);
			expect(result.statuses[1]?.deviationScore).toBe(70);
			// 300/200 = 1.5 → ratio >= 1.2 → 4 stars
			expect(result.statuses[1]?.stars).toBe(4);
		}
	});

	it('ステータス更新が正常に動作する（XP累積）', async () => {
		const updated = await updateStatus(1, 1, 10, 'activity_record', 'test-tenant');
		expect(updated).toBeDefined();
		expect('error' in updated).toBe(false);

		const status = await getChildStatus(1, 'test-tenant');
		if (!('error' in status)) {
			expect(status.statuses[1]?.value).toBe(10);
		}

		// 累積更新
		await updateStatus(1, 1, 8, 'activity_record', 'test-tenant');
		const status2 = await getChildStatus(1, 'test-tenant');
		if (!('error' in status2)) {
			expect(status2.statuses[1]?.value).toBe(18); // 10 + 8
		}
	});

	it('ステータスXPは0未満にならない', async () => {
		await updateStatus(1, 1, 10, 'activity_record', 'test-tenant');
		await updateStatus(1, 1, -100, 'decay', 'test-tenant');
		const status = await getChildStatus(1, 'test-tenant');
		if (!('error' in status)) {
			// peakXp=10, floor=10*0.7=7 → clampDecayFloor(10, 100, 10) = max(10-100, 7) = 7
			expect(status.statuses[1]?.value).toBe(7);
		}
	});

	it('減衰はpeakXpの70%で下限になる', async () => {
		// 100 XP まで上げる
		await updateStatus(1, 1, 100, 'activity_record', 'test-tenant');
		// 大きな減衰 → peakXp=100, floor=70
		await updateStatus(1, 1, -80, 'decay', 'test-tenant');
		const status = await getChildStatus(1, 'test-tenant');
		if (!('error' in status)) {
			expect(status.statuses[1]?.value).toBe(70); // clamped to 70% of peak
		}
	});

	it('レベルアップ時にlevelUp情報が返る（Lv.1→2: 15XP境界）', async () => {
		// 14 XP → Lv.1
		await updateStatus(1, 1, 14, 'activity_record', 'test-tenant');
		const before = await getChildStatus(1, 'test-tenant');
		if (!('error' in before)) {
			expect(before.statuses[1]?.level).toBe(1);
		}

		// +2 → 16 XP → Lv.2
		const result = await updateStatus(1, 1, 2, 'activity_record', 'test-tenant');
		if (!('error' in result)) {
			expect(result.levelUp).not.toBeNull();
			expect(result.levelUp?.oldLevel).toBe(1);
			expect(result.levelUp?.newLevel).toBe(2);
			expect(result.levelUp?.newTitle).toBe('がんばりルーキー');
			expect(result.levelUp?.categoryId).toBe(1);
			expect(result.levelUp?.categoryName).toBe('うんどう');
		}
	});

	it('同一レベル内の変動ではlevelUpはnull', async () => {
		// 16 XP → Lv.2（Lv.3は40 XP）
		await updateStatus(1, 1, 16, 'activity_record', 'test-tenant');

		// +5 → 21 XP → まだLv.2
		const result = await updateStatus(1, 1, 5, 'activity_record', 'test-tenant');
		if (!('error' in result)) {
			expect(result.levelUp).toBeNull();
		}
	});

	it('XPに基づくレベルが正しく計算される', async () => {
		// 全カテゴリを500 XP → Lv.10（500 XP = Lv.10の必要XP）
		for (const catId of [1, 2, 3, 4, 5]) {
			await updateStatus(1, catId, 500, 'test', 'test-tenant');
		}

		const result = await getChildStatus(1, 'test-tenant');
		if (!('error' in result)) {
			expect(result.level).toBe(10); // highestCategoryLevel
			expect(result.highestCategoryLevel).toBe(10);
			expect(result.statuses[1]?.level).toBe(10);
			expect(result.statuses[1]?.levelTitle).toBe('かみさまレベル');
		}
	});

	it('キャラクタータイプが偏差値平均で決まる', async () => {
		seedBenchmarks();
		// 全カテゴリを350 XP → mean=200, stdDev=50 → 偏差値 (350-200)/50*10+50=80 → hero
		for (const catId of [1, 2, 3, 4, 5]) {
			await updateStatus(1, catId, 350, 'test', 'test-tenant');
		}

		const result = await getChildStatus(1, 'test-tenant');
		if (!('error' in result)) {
			expect(result.characterType).toBe('hero');
		}
	});

	it('存在しない子供のステータス更新はNOT_FOUND', async () => {
		const result = await updateStatus(999, 1, 10, 'activity_record', 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});
});
