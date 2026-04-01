// tests/unit/services/combo-service.test.ts
// コンボボーナスシステムのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	type TestDb,
	type TestSqlite,
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

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
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function resetDb() {
	resetAllTables(sqlite);
}

function seedChild() {
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

function seedActivity(_id: number, name: string, categoryId: number) {
	testDb.insert(schema.activities).values({ name, categoryId, icon: '🏃', basePoints: 5 }).run();
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

	it('1種類のみ → コンボなし', async () => {
		seedActivity(1, 'ランニング', 1);
		addLog(1, 1, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(0);
		expect(result.crossCategoryCombo).toBeNull();
		expect(result.totalNewBonus).toBe(0);
	});

	it('同一カテゴリ2種類 → ダブルコンボ +2P', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'サッカー', 1);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]?.name).toBe('ダブル');
		expect(result.categoryCombo[0]?.bonus).toBe(2);
		expect(result.crossCategoryCombo).toBeNull();
		expect(result.totalNewBonus).toBe(2);
	});

	it('同一カテゴリ3種類 → トリプルコンボ +5P', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'サッカー', 1);
		seedActivity(3, 'すいえい', 1);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]?.name).toBe('トリプル');
		expect(result.categoryCombo[0]?.bonus).toBe(5);
		expect(result.totalNewBonus).toBe(5);
	});

	it('同一カテゴリ4種類 → スーパーコンボ +10P', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'サッカー', 1);
		seedActivity(3, 'すいえい', 1);
		seedActivity(4, 'たいそう', 1);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);
		addLog(1, 4, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]?.name).toBe('スーパー');
		expect(result.categoryCombo[0]?.bonus).toBe(10);
		expect(result.totalNewBonus).toBe(10);
	});

	it('2カテゴリ横断 → にとうりゅう +3P', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'さんすう', 2);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(0); // each category has only 1 unique
		expect(result.crossCategoryCombo).not.toBeNull();
		expect(result.crossCategoryCombo?.name).toBe('にとうりゅう');
		expect(result.crossCategoryCombo?.bonus).toBe(3);
		expect(result.totalNewBonus).toBe(3);
	});

	it('3カテゴリ横断 → さんみいったい +8P', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'さんすう', 2);
		seedActivity(3, 'はみがき', 3);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.crossCategoryCombo?.name).toBe('さんみいったい');
		expect(result.crossCategoryCombo?.bonus).toBe(8);
		expect(result.totalNewBonus).toBe(8);
	});

	it('5カテゴリ横断 → パーフェクト +30P', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'さんすう', 2);
		seedActivity(3, 'はみがき', 3);
		seedActivity(4, 'あいさつ', 4);
		seedActivity(5, 'おえかき', 5);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);
		addLog(1, 4, TODAY);
		addLog(1, 5, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.crossCategoryCombo?.name).toBe('パーフェクト');
		expect(result.crossCategoryCombo?.bonus).toBe(30);
		expect(result.totalNewBonus).toBe(30);
	});

	it('カテゴリコンボ + クロスカテゴリコンボの複合', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'サッカー', 1);
		seedActivity(3, 'さんすう', 2);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);
		addLog(1, 3, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		// Category combo: うんどう x2 = ダブル +2
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.categoryCombo[0]?.bonus).toBe(2);
		// Cross-category: 2 categories = にとうりゅう +3
		expect(result.crossCategoryCombo?.bonus).toBe(3);
		// Total: 2 + 3 = 5
		expect(result.totalNewBonus).toBe(5);
	});

	it('差分付与: 2回目の呼び出しで既存ボーナスを差し引く', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'サッカー', 1);
		seedActivity(3, 'すいえい', 1);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		// 1st call: ダブル +2
		const first = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(first.totalNewBonus).toBe(2);

		// Add 3rd activity
		addLog(1, 3, TODAY);

		// 2nd call: トリプル +5 total, but 2 already granted → +3 new
		const second = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(second.categoryCombo[0]?.name).toBe('トリプル');
		expect(second.categoryCombo[0]?.bonus).toBe(5);
		expect(second.totalNewBonus).toBe(3); // 5 - 2 = 3
	});

	it('キャンセル済みの活動はカウントしない', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'サッカー', 1);
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

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(0);
		expect(result.totalNewBonus).toBe(0);
	});

	it('異なるカテゴリで各1種 → ミニコンボ +1P（カテゴリコンボなし・クロスなし条件）', async () => {
		// ミニコンボはカテゴリコンボもクロスカテゴリコンボもない場合に発動
		// ただしにとうりゅう(2カテゴリ)が発動するため、このケースではミニコンボは出ない
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'さんすう', 2);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		// クロスカテゴリ(にとうりゅう)が発動 → ミニコンボは出ない
		expect(result.crossCategoryCombo).not.toBeNull();
		expect(result.miniCombo).toBeNull();
	});

	it('同カテゴリ2種類（カテゴリコンボあり）→ ミニコンボは出ない', async () => {
		seedActivity(1, 'ランニング', 1);
		seedActivity(2, 'サッカー', 1);
		addLog(1, 1, TODAY);
		addLog(1, 2, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(1);
		expect(result.miniCombo).toBeNull();
	});

	it('1種類のみ → ミニコンボなし・ヒント表示', async () => {
		seedActivity(1, 'ランニング', 1);
		addLog(1, 1, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.miniCombo).toBeNull();
		expect(result.hints.some((h) => h.message.includes('ミニコンボ'))).toBe(true);
	});

	it('カテゴリコンボまであと1つのヒント', async () => {
		seedActivity(1, 'ランニング', 1);
		addLog(1, 1, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.hints.some((h) => h.message.includes('ダブルコンボ'))).toBe(true);
	});

	it('クロスカテゴリまであと1つのヒント', async () => {
		seedActivity(1, 'ランニング', 1);
		addLog(1, 1, TODAY);

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.hints.some((h) => h.message.includes('にとうりゅう'))).toBe(true);
	});

	it('同じ活動を複数回実行してもコンボにならない', async () => {
		seedActivity(1, 'ランニング', 1);
		addLog(1, 1, TODAY);
		addLog(1, 1, TODAY); // same activity twice

		const result = await checkAndGrantCombo(1, TODAY, 'test-tenant');
		expect(result.categoryCombo).toHaveLength(0);
		expect(result.totalNewBonus).toBe(0);
	});
});
