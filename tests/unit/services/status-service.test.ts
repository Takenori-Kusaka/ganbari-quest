import { asCategoryId, asChildId } from '$lib/domain/ids';
// tests/unit/services/status-service.test.ts
// ステータスサービスのユニットテスト（新XPスケール対応）

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
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
	getCustomLevelTitles,
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
		const result = await getChildStatus(asChildId(999), 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('初期状態で全カテゴリXP=0のステータスを返す', async () => {
		const result = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(result.childId).toBe('1');
		expect(result.level).toBe(1); // highestCategoryLevel
		expect(Object.keys(result.statuses).length).toBe(5);
		expect(result.statuses[1]?.value).toBe(0);
		expect(result.statuses[1]?.level).toBe(1);
		expect(result.statuses[1]?.levelTitle).toBe('はじめのぼうけんしゃ');
		expect(result.statuses[1]?.expToNextLevel).toBe(15); // Lv.2 requires 15 XP
	});

	it('ベンチマークなしの場合、偏差値50・星3を返す', async () => {
		const result = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(result.statuses[1]?.deviationScore).toBe(50);
		expect(result.statuses[1]?.stars).toBe(3);
	});

	it('ベンチマークありの場合、偏差値を正しく計算する', async () => {
		seedBenchmarks();
		// うんどう = 300 XP, mean = 200, stdDev = 50 → 偏差値 (300-200)/50*10+50 = 70
		await updateStatus(asChildId(1), asCategoryId(1), 300, 'test', 'test-tenant');

		const result = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(result.statuses[1]?.value).toBe(300);
		expect(result.statuses[1]?.deviationScore).toBe(70);
		// 300/200 = 1.5 → ratio >= 1.2 → 4 stars
		expect(result.statuses[1]?.stars).toBe(4);
	});

	it('ステータス更新が正常に動作する（XP累積）', async () => {
		const updated = assertSuccess(
			await updateStatus(asChildId(1), asCategoryId(1), 10, 'activity_record', 'test-tenant'),
		);
		expect(updated).toBeDefined();

		const status = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(status.statuses[1]?.value).toBe(10);

		// 累積更新
		await updateStatus(asChildId(1), asCategoryId(1), 8, 'activity_record', 'test-tenant');
		const status2 = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(status2.statuses[1]?.value).toBe(18); // 10 + 8
	});

	it('ステータスXPは0未満にならない', async () => {
		await updateStatus(asChildId(1), asCategoryId(1), 10, 'activity_record', 'test-tenant');
		await updateStatus(asChildId(1), asCategoryId(1), -100, 'decay', 'test-tenant');
		const status = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		// peakXp=10, floor=10*0.7=7 → clampDecayFloor(10, 100, 10) = max(10-100, 7) = 7
		expect(status.statuses[1]?.value).toBe(7);
	});

	it('減衰はpeakXpの70%で下限になる', async () => {
		// 100 XP まで上げる
		await updateStatus(asChildId(1), asCategoryId(1), 100, 'activity_record', 'test-tenant');
		// 大きな減衰 → peakXp=100, floor=70
		await updateStatus(asChildId(1), asCategoryId(1), -80, 'decay', 'test-tenant');
		const status = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(status.statuses[1]?.value).toBe(70); // clamped to 70% of peak
	});

	it('レベルアップ時にlevelUp情報が返る（Lv.1→2: 15XP境界）', async () => {
		// 14 XP → Lv.1
		await updateStatus(asChildId(1), asCategoryId(1), 14, 'activity_record', 'test-tenant');
		const before = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(before.statuses[1]?.level).toBe(1);

		// +2 → 16 XP → Lv.2
		const result = assertSuccess(
			await updateStatus(asChildId(1), asCategoryId(1), 2, 'activity_record', 'test-tenant'),
		);
		expect(result.levelUp).not.toBeNull();
		expect(result.levelUp?.oldLevel).toBe(1);
		expect(result.levelUp?.newLevel).toBe(2);
		expect(result.levelUp?.newTitle).toBe('がんばりルーキー');
		expect(result.levelUp?.categoryId).toBe('1');
		expect(result.levelUp?.categoryName).toBe('うんどう');
	});

	it('同一レベル内の変動ではlevelUpはnull', async () => {
		// 16 XP → Lv.2（Lv.3は40 XP）
		await updateStatus(asChildId(1), asCategoryId(1), 16, 'activity_record', 'test-tenant');

		// +5 → 21 XP → まだLv.2
		const result = assertSuccess(
			await updateStatus(asChildId(1), asCategoryId(1), 5, 'activity_record', 'test-tenant'),
		);
		expect(result.levelUp).toBeNull();
	});

	it('XPに基づくレベルが正しく計算される', async () => {
		// 全カテゴリを500 XP → Lv.10（500 XP = Lv.10の必要XP）
		for (const catId of [1, 2, 3, 4, 5]) {
			await updateStatus(asChildId(1), asCategoryId(catId), 500, 'test', 'test-tenant');
		}

		const result = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(result.level).toBe(10); // highestCategoryLevel
		expect(result.highestCategoryLevel).toBe(10);
		expect(result.statuses[1]?.level).toBe(10);
		expect(result.statuses[1]?.levelTitle).toBe('かみさまレベル');
	});

	it('キャラクタータイプが偏差値平均で決まる', async () => {
		seedBenchmarks();
		// 全カテゴリを350 XP → mean=200, stdDev=50 → 偏差値 (350-200)/50*10+50=80 → hero
		for (const catId of [1, 2, 3, 4, 5]) {
			await updateStatus(asChildId(1), asCategoryId(catId), 350, 'test', 'test-tenant');
		}

		const result = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(result.characterType).toBe('hero');
	});

	it('存在しない子供のステータス更新はNOT_FOUND', async () => {
		const result = await updateStatus(
			asChildId(999),
			asCategoryId(1),
			10,
			'activity_record',
			'test-tenant',
		);
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
		const result = await getMonthlyComparison(asChildId(999), 'test-tenant');
		expect(result).toBeNull();
	});

	it('初期状態では全カテゴリcurrent=0, previous=0, changes=0', async () => {
		const result = await getMonthlyComparison(asChildId(1), 'test-tenant');
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
		await updateStatus(asChildId(1), asCategoryId(1), 100, 'activity_record', 'test-tenant');
		await updateStatus(asChildId(1), asCategoryId(2), 50, 'activity_record', 'test-tenant');

		const result = await getMonthlyComparison(asChildId(1), 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.current[1]).toBe(100);
		expect(result?.current[2]).toBe(50);
		// changes = current - previous（タイムゾーンにより previous が 0 or current と同じになる）
		expect(result?.changes[1]).toBe((result?.current[1] ?? 0) - (result?.previous[1] ?? 0));
		expect(result?.changes[2]).toBe((result?.current[2] ?? 0) - (result?.previous[2] ?? 0));
	});

	it('全5カテゴリ分のデータが返る', async () => {
		const result = await getMonthlyComparison(asChildId(1), 'test-tenant');
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
		const result = await getCategoryXpSummary(asChildId(999), 'test-tenant');
		expect(result).toBeNull();
	});

	it('初期状態で全カテゴリXP=0, level=1の情報を返す', async () => {
		const result = await getCategoryXpSummary(asChildId(1), 'test-tenant');
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
		await updateStatus(asChildId(1), asCategoryId(1), 50, 'activity_record', 'test-tenant');

		const result = await getCategoryXpSummary(asChildId(1), 'test-tenant');
		expect(result).not.toBeNull();

		const undou = result?.[1];
		expect(undou?.value).toBe(50);
		expect(undou?.level).toBe(3); // 40 XP = Lv.3
	});

	it('progressPctとexpToNextLevelが返る', async () => {
		// Lv.2は15 XP、Lv.3は40 XP。20 XP → Lv.2, progress = (20-15)/(40-15) = 5/25 = 20%
		await updateStatus(asChildId(1), asCategoryId(1), 20, 'activity_record', 'test-tenant');

		const result = await getCategoryXpSummary(asChildId(1), 'test-tenant');
		const undou = result?.[1];
		expect(undou?.level).toBe(2);
		expect(undou?.expToNextLevel).toBe(20); // 40 - 20
		expect(undou?.progressPct).toBe(20);
	});
});

// #4688 (F3): 親が設定したレベル称号が保存され、子供画面 (getChildStatus) にも届く。
// 旧実装は getCustomLevelTitles / saveLevelTitle が no-op stub で、保存できたように見えて
// 何も残らなかった (=「親が設定した称号が子供に出ない」の根)。
describe('レベル称号カスタマイズの永続化 (#4688)', () => {
	beforeEach(() => {
		resetDb();
	});

	it('保存した称号が読み出せ、既定の称号を上書きする', async () => {
		await saveLevelTitle('test-tenant', 3, 'なわとびマスター');

		const titles = await getCustomLevelTitles('test-tenant');
		expect(titles.get(3)).toBe('なわとびマスター');
		expect(resolveLevelTitle(3, titles)).toBe('なわとびマスター');
		// 未設定レベルは既定の称号のまま
		expect(resolveLevelTitle(4, titles)).not.toBe('なわとびマスター');
	});

	it('一覧 (admin 画面用) に customTitle が乗る', async () => {
		await saveLevelTitle('test-tenant', 2, 'よみきかせ名人');

		const list = await getLevelTitleList('test-tenant');
		expect(list.find((e) => e.level === 2)?.customTitle).toBe('よみきかせ名人');
		expect(list.find((e) => e.level === 3)?.customTitle).toBeNull();
	});

	// tenant 分離は backend が担う: sqlite backend は 1 tenant = 1 DB file の**物理分離**
	// (settings は tenant 列を持たない)、dsql backend は settings の family_id 述語で分離する。
	// そのため sqlite を使う本 test で「tenant を跨いで漏れない」を主張すると嘘になる。
	// dsql 側の述語は tests/unit/db/ の dsql settings repo test が assert している。

	it('空文字保存 / reset で既定に戻る', async () => {
		await saveLevelTitle('test-tenant', 3, 'なわとびマスター');
		await saveLevelTitle('test-tenant', 3, '   ');
		expect((await getCustomLevelTitles('test-tenant')).get(3)).toBeUndefined();

		await saveLevelTitle('test-tenant', 5, 'たいそう王');
		await resetLevelTitle('test-tenant', 5);
		expect((await getCustomLevelTitles('test-tenant')).get(5)).toBeUndefined();

		await saveLevelTitle('test-tenant', 6, 'あいさつ名人');
		await resetAllLevelTitles('test-tenant');
		expect((await getCustomLevelTitles('test-tenant')).size).toBe(0);
	});

	it('子供のステータス (getChildStatus) の levelTitle に反映される', async () => {
		seedChild();
		// Lv.3 (40 XP) まで上げる
		await updateStatus(asChildId(1), asCategoryId(1), 45, 'activity_record', 'test-tenant');
		await saveLevelTitle('test-tenant', 3, 'なわとびマスター');

		const status = assertSuccess(await getChildStatus(asChildId(1), 'test-tenant'));
		expect(status.statuses['1']?.level).toBe(3);
		expect(status.statuses['1']?.levelTitle).toBe('なわとびマスター');
	});
});
