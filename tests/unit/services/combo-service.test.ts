// tests/unit/services/combo-service.test.ts
// コンボボーナスシステムのユニットテスト

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
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
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
		source TEXT NOT NULL DEFAULT 'seed',
		grade_level TEXT, subcategory TEXT, description TEXT,
		name_kana TEXT,
		name_kanji TEXT,
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

import { checkAndGrantCombo } from '../../../src/lib/server/services/combo-service';

const TODAY = '2026-03-07';

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
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children', 'activities', 'activity_logs', 'point_ledger')",
	);
}

function seedChild() {
	testDb
		.insert(schema.children)
		.values({ nickname: 'テストちゃん', age: 4, theme: 'pink' })
		.run();
}

function seedActivity(id: number, name: string, category: string) {
	testDb
		.insert(schema.activities)
		.values({ name, category, icon: '🏃', basePoints: 5 })
		.run();
}

function addLog(childId: number, activityId: number, date: string) {
	testDb
		.insert(schema.activityLogs)
		.values({
			childId,
			activityId,
			points: 5,
			streakDays: 1,
			streakBonus: 0,
			recordedDate: date,
		})
		.run();
}

describe('combo-service', () => {
	beforeEach(() => {
		resetDb();
		seedChild();
	});

	it('1種類のみ → コンボなし', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		addLog(1, 1, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(0);
		expect(result.crossCategoryCombo).toBeNull();
		expect(result.totalNewBonus).toBe(0);
	});

	it('同一カテゴリ2種類 → ダブルコンボ +2P', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'サッカー', 'うんどう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]!.name).toBe('ダブル');
		expect(result.categoryCombo[0]!.bonus).toBe(2);
		expect(result.crossCategoryCombo).toBeNull();
		expect(result.totalNewBonus).toBe(2);
	});

	it('同一カテゴリ3種類 → トリプルコンボ +5P', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'サッカー', 'うんどう');
		seedActivity(3, 'すいえい', 'うんどう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]!.name).toBe('トリプル');
		expect(result.categoryCombo[0]!.bonus).toBe(5);
		expect(result.totalNewBonus).toBe(5);
	});

	it('同一カテゴリ4種類 → スーパーコンボ +10P', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'サッカー', 'うんどう');
		seedActivity(3, 'すいえい', 'うんどう');
		seedActivity(4, 'たいそう', 'うんどう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);
		addLog(1, 4, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]!.name).toBe('スーパー');
		expect(result.categoryCombo[0]!.bonus).toBe(10);
		expect(result.totalNewBonus).toBe(10);
	});

	it('2カテゴリ横断 → にとうりゅう +3P', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'さんすう', 'べんきょう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(0); // each category has only 1 unique
		expect(result.crossCategoryCombo).not.toBeNull();
		expect(result.crossCategoryCombo!.name).toBe('にとうりゅう');
		expect(result.crossCategoryCombo!.bonus).toBe(3);
		expect(result.totalNewBonus).toBe(3);
	});

	it('3カテゴリ横断 → さんみいったい +8P', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'さんすう', 'べんきょう');
		seedActivity(3, 'はみがき', 'せいかつ');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.crossCategoryCombo!.name).toBe('さんみいったい');
		expect(result.crossCategoryCombo!.bonus).toBe(8);
		expect(result.totalNewBonus).toBe(8);
	});

	it('5カテゴリ横断 → パーフェクト +30P', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'さんすう', 'べんきょう');
		seedActivity(3, 'はみがき', 'せいかつ');
		seedActivity(4, 'あいさつ', 'こうりゅう');
		seedActivity(5, 'おえかき', 'そうぞう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);
		addLog(1, 4, TODAY);
		addLog(1, 5, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.crossCategoryCombo!.name).toBe('パーフェクト');
		expect(result.crossCategoryCombo!.bonus).toBe(30);
		expect(result.totalNewBonus).toBe(30);
	});

	it('カテゴリコンボ + クロスカテゴリコンボの複合', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'サッカー', 'うんどう');
		seedActivity(3, 'さんすう', 'べんきょう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		// Category combo: うんどう x2 = ダブル +2
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]!.bonus).toBe(2);
		// Cross-category: 2 categories = にとうりゅう +3
		expect(result.crossCategoryCombo!.bonus).toBe(3);
		// Total: 2 + 3 = 5
		expect(result.totalNewBonus).toBe(5);
	});

	it('差分付与: 2回目の呼び出しで既存ボーナスを差し引く', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'サッカー', 'うんどう');
		seedActivity(3, 'すいえい', 'うんどう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		// 1st call: ダブル +2
		const first = checkAndGrantCombo(1, TODAY);
		expect(first.totalNewBonus).toBe(2);

		// Add 3rd activity
		addLog(1, 3, TODAY);

		// 2nd call: トリプル +5 total, but 2 already granted → +3 new
		const second = checkAndGrantCombo(1, TODAY);
		expect(second.categoryCombo[0]!.name).toBe('トリプル');
		expect(second.categoryCombo[0]!.bonus).toBe(5);
		expect(second.totalNewBonus).toBe(3); // 5 - 2 = 3
	});

	it('キャンセル済みの活動はカウントしない', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'サッカー', 'うんどう');
		addLog(1, 1, TODAY);
		// Add cancelled log
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 2,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: TODAY,
				cancelled: 1,
			})
			.run();

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(0);
		expect(result.totalNewBonus).toBe(0);
	});

	it('異なるカテゴリで各1種 → ミニコンボ +1P（カテゴリコンボなし・クロスなし条件）', () => {
		// ミニコンボはカテゴリコンボもクロスカテゴリコンボもない場合に発動
		// ただしにとうりゅう(2カテゴリ)が発動するため、このケースではミニコンボは出ない
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'さんすう', 'べんきょう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		// クロスカテゴリ(にとうりゅう)が発動 → ミニコンボは出ない
		expect(result.crossCategoryCombo).not.toBeNull();
		expect(result.miniCombo).toBeNull();
	});

	it('同カテゴリ2種類（カテゴリコンボあり）→ ミニコンボは出ない', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		seedActivity(2, 'サッカー', 'うんどう');
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.miniCombo).toBeNull();
	});

	it('1種類のみ → ミニコンボなし・ヒント表示', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		addLog(1, 1, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.miniCombo).toBeNull();
		expect(result.hints.some((h) => h.message.includes('ミニコンボ'))).toBe(true);
	});

	it('カテゴリコンボまであと1つのヒント', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		addLog(1, 1, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.hints.some((h) => h.message.includes('ダブルコンボ'))).toBe(true);
	});

	it('クロスカテゴリまであと1つのヒント', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		addLog(1, 1, TODAY);

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.hints.some((h) => h.message.includes('にとうりゅう'))).toBe(true);
	});

	it('同じ活動を複数回実行してもコンボにならない', () => {
		seedActivity(1, 'ランニング', 'うんどう');
		addLog(1, 1, TODAY);
		addLog(1, 1, TODAY); // same activity twice

		const result = checkAndGrantCombo(1, TODAY);
		expect(result.categoryCombo).toHaveLength(0);
		expect(result.totalNewBonus).toBe(0);
	});
});
