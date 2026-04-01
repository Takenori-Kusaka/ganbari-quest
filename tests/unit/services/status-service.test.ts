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

import {
	getBenchmarkValues,
	getCategoryXpSummary,
	getChildStatus,
	getLevelTitleList,
	getMonthlyComparison,
	resetAllLevelTitles,
	resetLevelTitle,
	resolveLevelTitle,
	saveLevelTitle,
	updateStatus,
} from '../../../src/lib/server/services/status-service';

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

// ============================================================
// resolveLevelTitle
// ============================================================

describe('resolveLevelTitle', () => {
	it('カスタム称号がない場合はデフォルト称号を返す', () => {
		const customTitles = new Map<number, string>();
		expect(resolveLevelTitle(1, customTitles)).toBe('はじめのぼうけんしゃ');
		expect(resolveLevelTitle(2, customTitles)).toBe('がんばりルーキー');
		expect(resolveLevelTitle(10, customTitles)).toBe('かみさまレベル');
	});

	it('カスタム称号が設定されている場合はカスタム称号を返す', () => {
		const customTitles = new Map<number, string>([
			[1, 'カスタムLv1'],
			[5, 'マイヒーロー'],
		]);
		expect(resolveLevelTitle(1, customTitles)).toBe('カスタムLv1');
		expect(resolveLevelTitle(5, customTitles)).toBe('マイヒーロー');
		// カスタムなしのレベルはデフォルト
		expect(resolveLevelTitle(2, customTitles)).toBe('がんばりルーキー');
	});

	it('LEVEL_TABLEに存在しないレベルではデフォルト称号は空文字', () => {
		const customTitles = new Map<number, string>();
		expect(resolveLevelTitle(0, customTitles)).toBe('');
		expect(resolveLevelTitle(100, customTitles)).toBe('');
	});

	it('LEVEL_TABLEに存在しないレベルでもカスタム称号があれば返す', () => {
		const customTitles = new Map<number, string>([[100, 'アルティメット']]);
		expect(resolveLevelTitle(100, customTitles)).toBe('アルティメット');
	});
});

// ============================================================
// getMonthlyComparison
// ============================================================

describe('getMonthlyComparison', () => {
	beforeEach(() => {
		seedChild();
	});

	it('存在しない子供はnullを返す', async () => {
		const result = await getMonthlyComparison(999, 'test-tenant');
		expect(result).toBeNull();
	});

	it('初期状態では全カテゴリcurrent=0, previous=0, changes=0', async () => {
		const result = await getMonthlyComparison(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(Object.keys(result?.current ?? {}).length).toBe(5);

		for (const catId of [1, 2, 3, 4, 5]) {
			expect(result?.current[catId]).toBe(0);
			expect(result?.previous[catId]).toBe(0);
			expect(result?.changes[catId]).toBe(0);
		}
	});

	it('XP追加後にcurrentが反映され、changes = current - previous', async () => {
		// うんどう=100, べんきょう=50
		await updateStatus(1, 1, 100, 'activity_record', 'test-tenant');
		await updateStatus(1, 2, 50, 'activity_record', 'test-tenant');

		const result = await getMonthlyComparison(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.current[1]).toBe(100);
		expect(result?.current[2]).toBe(50);
		// changes = current - previous（タイムゾーンにより previous が 0 or current と同じになる）
		expect(result?.changes[1]).toBe((result?.current[1] ?? 0) - (result?.previous[1] ?? 0));
		expect(result?.changes[2]).toBe((result?.current[2] ?? 0) - (result?.previous[2] ?? 0));
	});

	it('全5カテゴリ分のデータが返る', async () => {
		const result = await getMonthlyComparison(1, 'test-tenant');
		expect(result).not.toBeNull();
		const catIds = Object.keys(result?.current ?? {}).map(Number);
		expect(catIds.sort()).toEqual([1, 2, 3, 4, 5]);
	});
});

// ============================================================
// getBenchmarkValues
// ============================================================

describe('getBenchmarkValues', () => {
	beforeEach(() => {
		seedChild();
	});

	it('ベンチマーク未登録の場合は全カテゴリ0を返す', async () => {
		const result = await getBenchmarkValues(4, 'test-tenant');
		expect(Object.keys(result).length).toBe(5);
		for (const catId of [1, 2, 3, 4, 5]) {
			expect(result[catId]).toBe(0);
		}
	});

	it('ベンチマーク登録済みの場合はmean値を返す', async () => {
		seedBenchmarks();
		const result = await getBenchmarkValues(4, 'test-tenant');
		for (const catId of [1, 2, 3, 4, 5]) {
			expect(result[catId]).toBe(200);
		}
	});

	it('異なる年齢のベンチマークは返さない', async () => {
		seedBenchmarks(); // age=4 のベンチマーク
		const result = await getBenchmarkValues(8, 'test-tenant');
		for (const catId of [1, 2, 3, 4, 5]) {
			expect(result[catId]).toBe(0);
		}
	});

	it('一部カテゴリのみベンチマークがある場合', async () => {
		// カテゴリ1と3のみ登録
		testDb
			.insert(schema.marketBenchmarks)
			.values({ age: 6, categoryId: 1, mean: 300, stdDev: 60, source: 'test' })
			.run();
		testDb
			.insert(schema.marketBenchmarks)
			.values({ age: 6, categoryId: 3, mean: 150, stdDev: 30, source: 'test' })
			.run();

		const result = await getBenchmarkValues(6, 'test-tenant');
		expect(result[1]).toBe(300);
		expect(result[2]).toBe(0);
		expect(result[3]).toBe(150);
		expect(result[4]).toBe(0);
		expect(result[5]).toBe(0);
	});
});

// ============================================================
// getCategoryXpSummary
// ============================================================

describe('getCategoryXpSummary', () => {
	beforeEach(() => {
		seedChild();
	});

	it('存在しない子供はnullを返す', async () => {
		const result = await getCategoryXpSummary(999, 'test-tenant');
		expect(result).toBeNull();
	});

	it('初期状態で全カテゴリXP=0, level=1の情報を返す', async () => {
		const result = await getCategoryXpSummary(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(Object.keys(result ?? {}).length).toBe(5);

		for (const catId of [1, 2, 3, 4, 5]) {
			const info = result?.[catId];
			expect(info?.value).toBe(0);
			expect(info?.level).toBe(1);
			expect(info?.levelTitle).toBe('はじめのぼうけんしゃ');
			expect(info?.maxValue).toBe(100000);
		}
	});

	it('XP追加後にレベルと称号が正しく反映される', async () => {
		await updateStatus(1, 1, 50, 'activity_record', 'test-tenant');

		const result = await getCategoryXpSummary(1, 'test-tenant');
		expect(result).not.toBeNull();

		const undou = result?.[1];
		expect(undou?.value).toBe(50);
		expect(undou?.level).toBe(3); // 40 XP = Lv.3
	});

	it('progressPctとexpToNextLevelが返る', async () => {
		// Lv.2は15 XP、Lv.3は40 XP。20 XP → Lv.2, progress = (20-15)/(40-15) = 5/25 = 20%
		await updateStatus(1, 1, 20, 'activity_record', 'test-tenant');

		const result = await getCategoryXpSummary(1, 'test-tenant');
		const undou = result?.[1];
		expect(undou?.level).toBe(2);
		expect(undou?.expToNextLevel).toBe(20); // 40 - 20
		expect(undou?.progressPct).toBe(20);
	});

	it('カスタム称号が反映される', async () => {
		await saveLevelTitle('test-tenant', 1, 'カスタム初心者');

		const result = await getCategoryXpSummary(1, 'test-tenant');
		const undou = result?.[1];
		expect(undou?.levelTitle).toBe('カスタム初心者');
	});
});

// ============================================================
// getLevelTitleList
// ============================================================

describe('getLevelTitleList', () => {
	beforeEach(() => {
		seedChild();
	});

	it('カスタム称号なしの場合はデフォルト一覧を返す', async () => {
		const list = await getLevelTitleList('test-tenant');

		// LEVEL_TABLE は Lv.1-99 の99要素
		expect(list.length).toBe(99);

		const lv1 = list.find((e) => e.level === 1);
		expect(lv1?.defaultTitle).toBe('はじめのぼうけんしゃ');
		expect(lv1?.customTitle).toBeNull();

		const lv10 = list.find((e) => e.level === 10);
		expect(lv10?.defaultTitle).toBe('かみさまレベル');
		expect(lv10?.customTitle).toBeNull();
	});

	it('カスタム称号が設定されている場合はcustomTitleに反映される', async () => {
		await saveLevelTitle('test-tenant', 3, 'カスタムLv3');
		await saveLevelTitle('test-tenant', 7, 'マイチャンピオン');

		const list = await getLevelTitleList('test-tenant');

		const lv3 = list.find((e) => e.level === 3);
		expect(lv3?.defaultTitle).toBe('わくわくファイター');
		expect(lv3?.customTitle).toBe('カスタムLv3');

		const lv7 = list.find((e) => e.level === 7);
		expect(lv7?.defaultTitle).toBe('そらとぶチャンピオン');
		expect(lv7?.customTitle).toBe('マイチャンピオン');

		// カスタムなしのレベルはnull
		const lv1 = list.find((e) => e.level === 1);
		expect(lv1?.customTitle).toBeNull();
	});

	it('異なるテナントのカスタム称号は混ざらない', async () => {
		await saveLevelTitle('tenant-a', 1, 'テナントAの称号');
		await saveLevelTitle('tenant-b', 1, 'テナントBの称号');

		const listA = await getLevelTitleList('tenant-a');
		const listB = await getLevelTitleList('tenant-b');

		const lv1A = listA.find((e) => e.level === 1);
		const lv1B = listB.find((e) => e.level === 1);
		expect(lv1A?.customTitle).toBe('テナントAの称号');
		expect(lv1B?.customTitle).toBe('テナントBの称号');
	});
});

// ============================================================
// saveLevelTitle
// ============================================================

describe('saveLevelTitle', () => {
	beforeEach(() => {
		seedChild();
	});

	it('カスタム称号を新規保存できる', async () => {
		await saveLevelTitle('test-tenant', 5, 'オリジナルヒーロー');

		const list = await getLevelTitleList('test-tenant');
		const lv5 = list.find((e) => e.level === 5);
		expect(lv5?.customTitle).toBe('オリジナルヒーロー');
	});

	it('同一レベルの称号を上書き更新（upsert）できる', async () => {
		await saveLevelTitle('test-tenant', 3, '最初の名前');
		await saveLevelTitle('test-tenant', 3, '変更後の名前');

		const list = await getLevelTitleList('test-tenant');
		const lv3 = list.find((e) => e.level === 3);
		expect(lv3?.customTitle).toBe('変更後の名前');
	});

	it('前後の空白がtrimされる', async () => {
		await saveLevelTitle('test-tenant', 2, '  スペース付き  ');

		const list = await getLevelTitleList('test-tenant');
		const lv2 = list.find((e) => e.level === 2);
		expect(lv2?.customTitle).toBe('スペース付き');
	});

	it('保存後にgetChildStatusで反映される', async () => {
		await saveLevelTitle('test-tenant', 1, 'ビギナー冒険者');

		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));
		// 全カテゴリLv.1なのでカスタム称号が各カテゴリに反映
		for (const catId of [1, 2, 3, 4, 5]) {
			expect(result.statuses[catId]?.levelTitle).toBe('ビギナー冒険者');
		}
		// 全体のlevelTitleにも反映
		expect(result.levelTitle).toBe('ビギナー冒険者');
	});
});

// ============================================================
// resetLevelTitle
// ============================================================

describe('resetLevelTitle', () => {
	beforeEach(() => {
		seedChild();
	});

	it('カスタム称号を削除するとデフォルトに戻る', async () => {
		await saveLevelTitle('test-tenant', 4, 'カスタム称号');

		// 削除前は確認
		const beforeList = await getLevelTitleList('test-tenant');
		expect(beforeList.find((e) => e.level === 4)?.customTitle).toBe('カスタム称号');

		await resetLevelTitle('test-tenant', 4);

		const afterList = await getLevelTitleList('test-tenant');
		expect(afterList.find((e) => e.level === 4)?.customTitle).toBeNull();
	});

	it('存在しないレベルのリセットはエラーにならない', async () => {
		// 未登録のレベルをリセットしてもエラーにならない
		await expect(resetLevelTitle('test-tenant', 99)).resolves.toBeUndefined();
	});

	it('他のレベルのカスタム称号に影響しない', async () => {
		await saveLevelTitle('test-tenant', 1, 'カスタムLv1');
		await saveLevelTitle('test-tenant', 2, 'カスタムLv2');
		await saveLevelTitle('test-tenant', 3, 'カスタムLv3');

		await resetLevelTitle('test-tenant', 2);

		const list = await getLevelTitleList('test-tenant');
		expect(list.find((e) => e.level === 1)?.customTitle).toBe('カスタムLv1');
		expect(list.find((e) => e.level === 2)?.customTitle).toBeNull();
		expect(list.find((e) => e.level === 3)?.customTitle).toBe('カスタムLv3');
	});
});

// ============================================================
// resetAllLevelTitles
// ============================================================

describe('resetAllLevelTitles', () => {
	beforeEach(() => {
		seedChild();
	});

	it('全カスタム称号を一括削除する', async () => {
		await saveLevelTitle('test-tenant', 1, 'カスタム1');
		await saveLevelTitle('test-tenant', 5, 'カスタム5');
		await saveLevelTitle('test-tenant', 10, 'カスタム10');

		await resetAllLevelTitles('test-tenant');

		const list = await getLevelTitleList('test-tenant');
		for (const entry of list) {
			expect(entry.customTitle).toBeNull();
		}
	});

	it('カスタム称号がない状態でもエラーにならない', async () => {
		await expect(resetAllLevelTitles('test-tenant')).resolves.toBeUndefined();
	});

	it('他テナントのカスタム称号に影響しない', async () => {
		await saveLevelTitle('tenant-a', 1, 'テナントA');
		await saveLevelTitle('tenant-b', 1, 'テナントB');

		await resetAllLevelTitles('tenant-a');

		const listA = await getLevelTitleList('tenant-a');
		const listB = await getLevelTitleList('tenant-b');

		expect(listA.find((e) => e.level === 1)?.customTitle).toBeNull();
		expect(listB.find((e) => e.level === 1)?.customTitle).toBe('テナントB');
	});
});

// ============================================================
// getChildStatus + resolveLevelTitle (カスタム称号パス統合テスト)
// ============================================================

describe('getChildStatus — カスタム称号統合', () => {
	beforeEach(() => {
		seedChild();
	});

	it('カスタム称号がgetChildStatusの各カテゴリに正しく反映される', async () => {
		await saveLevelTitle('test-tenant', 1, 'マイスターター');
		await saveLevelTitle('test-tenant', 2, 'マイルーキー');

		// うんどうだけLv.2に上げる
		await updateStatus(1, 1, 16, 'activity_record', 'test-tenant');

		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));

		// うんどう = Lv.2 → カスタム「マイルーキー」
		expect(result.statuses[1]?.levelTitle).toBe('マイルーキー');
		// べんきょう等 = Lv.1 → カスタム「マイスターター」
		expect(result.statuses[2]?.levelTitle).toBe('マイスターター');
		expect(result.statuses[3]?.levelTitle).toBe('マイスターター');
	});

	it('一部レベルのみカスタムで残りはデフォルトが返る', async () => {
		await saveLevelTitle('test-tenant', 2, 'カスタムLv2のみ');

		await updateStatus(1, 1, 16, 'activity_record', 'test-tenant');

		const result = assertSuccess(await getChildStatus(1, 'test-tenant'));

		// うんどう Lv.2 → カスタム
		expect(result.statuses[1]?.levelTitle).toBe('カスタムLv2のみ');
		// べんきょう Lv.1 → デフォルト
		expect(result.statuses[2]?.levelTitle).toBe('はじめのぼうけんしゃ');
	});

	it('updateStatusのlevelUpでもカスタム称号が使われる', async () => {
		await saveLevelTitle('test-tenant', 2, 'レベルアップ称号');

		// Lv.1 → Lv.2 のレベルアップ
		await updateStatus(1, 1, 14, 'activity_record', 'test-tenant');
		const result = assertSuccess(await updateStatus(1, 1, 2, 'activity_record', 'test-tenant'));

		expect(result.levelUp).not.toBeNull();
		expect(result.levelUp?.newTitle).toBe('レベルアップ称号');
	});
});
