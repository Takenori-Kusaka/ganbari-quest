// tests/unit/services/status-service.test.ts
// ステータスサービスのユニットテスト（新XPスケール対応）

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
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

import { getChildStatus, updateStatus } from '../../../src/lib/server/services/status-service';

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
		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(result.childId).toBe(1);
		expect(result.level).toBe(1); // highestCategoryLevel
		expect(Object.keys(result.statuses).length).toBe(5);
		expect(result.statuses[1]?.value).toBe(0);
		expect(result.statuses[1]?.level).toBe(1);
		expect(result.statuses[1]?.levelTitle).toBe('はじめのぼうけんしゃ');
		expect(result.statuses[1]?.expToNextLevel).toBe(15); // Lv.2 requires 15 XP
	});

	it('ベンチマークなしの場合、偏差値50・星3を返す', async () => {
		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(result.statuses[1]?.deviationScore).toBe(50);
		expect(result.statuses[1]?.stars).toBe(3);
	});

	it('ベンチマークありの場合、偏差値を正しく計算する', async () => {
		seedBenchmarks();
		// うんどう = 300 XP, mean = 200, stdDev = 50 → 偏差値 (300-200)/50*10+50 = 70
		await updateStatus(1, 1, 300, 'test', 'test-tenant');

		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(result.statuses[1]?.value).toBe(300);
		expect(result.statuses[1]?.deviationScore).toBe(70);
		// 300/200 = 1.5 → ratio >= 1.2 → 4 stars
		expect(result.statuses[1]?.stars).toBe(4);
	});

	it('ステータス更新が正常に動作する（XP累積）', async () => {
		const updated = assertSuccess(await updateStatus(1, 1, 10, 'activity_record', 'test-tenant'));
		expect(updated).toBeDefined();

		const status = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(status.statuses[1]?.value).toBe(10);

		// 累積更新
		await updateStatus(1, 1, 8, 'activity_record', 'test-tenant');
		const status2 = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(status2.statuses[1]?.value).toBe(18); // 10 + 8
	});

	it('ステータスXPは0未満にならない', async () => {
		await updateStatus(1, 1, 10, 'activity_record', 'test-tenant');
		await updateStatus(1, 1, -100, 'decay', 'test-tenant');
		const status = assertSuccess(await getChildStatus(1, 'test-tenant'));
		// peakXp=10, floor=10*0.7=7 → clampDecayFloor(10, 100, 10) = max(10-100, 7) = 7
		expect(status.statuses[1]?.value).toBe(7);
	});

	it('減衰はpeakXpの70%で下限になる', async () => {
		// 100 XP まで上げる
		await updateStatus(1, 1, 100, 'activity_record', 'test-tenant');
		// 大きな減衰 → peakXp=100, floor=70
		await updateStatus(1, 1, -80, 'decay', 'test-tenant');
		const status = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(status.statuses[1]?.value).toBe(70); // clamped to 70% of peak
	});

	it('レベルアップ時にlevelUp情報が返る（Lv.1→2: 15XP境界）', async () => {
		// 14 XP → Lv.1
		await updateStatus(1, 1, 14, 'activity_record', 'test-tenant');
		const before = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(before.statuses[1]?.level).toBe(1);

		// +2 → 16 XP → Lv.2
		const result = assertSuccess(await updateStatus(1, 1, 2, 'activity_record', 'test-tenant'));
		expect(result.levelUp).not.toBeNull();
		expect(result.levelUp?.oldLevel).toBe(1);
		expect(result.levelUp?.newLevel).toBe(2);
		expect(result.levelUp?.newTitle).toBe('がんばりルーキー');
		expect(result.levelUp?.categoryId).toBe(1);
		expect(result.levelUp?.categoryName).toBe('うんどう');
	});

	it('同一レベル内の変動ではlevelUpはnull', async () => {
		// 16 XP → Lv.2（Lv.3は40 XP）
		await updateStatus(1, 1, 16, 'activity_record', 'test-tenant');

		// +5 → 21 XP → まだLv.2
		const result = assertSuccess(await updateStatus(1, 1, 5, 'activity_record', 'test-tenant'));
		expect(result.levelUp).toBeNull();
	});

	it('XPに基づくレベルが正しく計算される', async () => {
		// 全カテゴリを500 XP → Lv.10（500 XP = Lv.10の必要XP）
		for (const catId of [1, 2, 3, 4, 5]) {
			await updateStatus(1, catId, 500, 'test', 'test-tenant');
		}

		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(result.level).toBe(10); // highestCategoryLevel
		expect(result.highestCategoryLevel).toBe(10);
		expect(result.statuses[1]?.level).toBe(10);
		expect(result.statuses[1]?.levelTitle).toBe('かみさまレベル');
	});

	it('キャラクタータイプが偏差値平均で決まる', async () => {
		seedBenchmarks();
		// 全カテゴリを350 XP → mean=200, stdDev=50 → 偏差値 (350-200)/50*10+50=80 → hero
		for (const catId of [1, 2, 3, 4, 5]) {
			await updateStatus(1, catId, 350, 'test', 'test-tenant');
		}

		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));
		expect(result.characterType).toBe('hero');
	});

	it('存在しない子供のステータス更新はNOT_FOUND', async () => {
		const result = await updateStatus(999, 1, 10, 'activity_record', 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});
});
