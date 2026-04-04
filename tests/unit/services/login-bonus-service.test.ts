// tests/unit/services/login-bonus-service.test.ts
// ログインボーナスサービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
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

// todayDateJST をモックして日付を制御（prevDateJST は実際の計算を使う）
let mockToday = '2026-03-10';
vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => mockToday,
	prevDateJST: (dateStr: string) => {
		const d = new Date(`${dateStr}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - 1);
		return d.toISOString().slice(0, 10);
	},
}));

import {
	calcLoginBonusPoints,
	drawOmikuji,
	getLoginMultiplier,
	OMIKUJI_RANKS,
} from '../../../src/lib/domain/validation/login-bonus';
import {
	calculateConsecutiveDays,
	claimLoginBonus,
	getLoginBonusStatus,
} from '../../../src/lib/server/services/login-bonus-service';

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

function addBonus(childId: number, date: string, consecutiveDays = 1) {
	testDb
		.insert(schema.loginBonuses)
		.values({
			childId,
			loginDate: date,
			rank: '吉',
			basePoints: 3,
			multiplier: 1.0,
			totalPoints: 3,
			consecutiveDays,
		})
		.run();
}

describe('OMIKUJI_RANKS', () => {
	it('6ランク定義されている', () => {
		expect(OMIKUJI_RANKS.length).toBe(6);
	});

	it('確率合計が100', () => {
		const total = OMIKUJI_RANKS.reduce((s, r) => s + r.weight, 0);
		expect(total).toBe(100);
	});
});

describe('drawOmikuji', () => {
	it('有効なランクを返す', () => {
		const result = drawOmikuji();
		expect(OMIKUJI_RANKS.some((r) => r.rank === result.rank)).toBe(true);
		expect(result.basePoints).toBeGreaterThan(0);
	});

	it('100回引いても全て有効なランク', () => {
		for (let i = 0; i < 100; i++) {
			const result = drawOmikuji();
			expect(OMIKUJI_RANKS.some((r) => r.rank === result.rank)).toBe(true);
		}
	});
});

describe('getLoginMultiplier', () => {
	it('1日目は等倍', () => {
		expect(getLoginMultiplier(1)).toBe(1.0);
	});

	it('2日連続は等倍', () => {
		expect(getLoginMultiplier(2)).toBe(1.0);
	});

	it('3日連続で1.5倍', () => {
		expect(getLoginMultiplier(3)).toBe(1.5);
	});

	it('7日連続で2.0倍', () => {
		expect(getLoginMultiplier(7)).toBe(2.0);
	});

	it('14日連続で2.5倍', () => {
		expect(getLoginMultiplier(14)).toBe(2.5);
	});

	it('30日連続で3.0倍', () => {
		expect(getLoginMultiplier(30)).toBe(3.0);
	});

	it('60日連続でも3.0倍（上限）', () => {
		expect(getLoginMultiplier(60)).toBe(3.0);
	});
});

describe('calcLoginBonusPoints', () => {
	it('等倍でそのまま', () => {
		expect(calcLoginBonusPoints(5, 1.0)).toBe(5);
	});

	it('1.5倍で切り捨て', () => {
		expect(calcLoginBonusPoints(5, 1.5)).toBe(7);
	});

	it('2.0倍', () => {
		expect(calcLoginBonusPoints(7, 2.0)).toBe(14);
	});

	it('3.0倍', () => {
		expect(calcLoginBonusPoints(30, 3.0)).toBe(90);
	});
});

describe('calculateConsecutiveDays', () => {
	beforeEach(() => {
		seedChild();
	});

	it('初回は1日', async () => {
		expect(await calculateConsecutiveDays(1, '2026-02-21', 'test-tenant')).toBe(1);
	});

	it('連続2日', async () => {
		addBonus(1, '2026-02-20');
		expect(await calculateConsecutiveDays(1, '2026-02-21', 'test-tenant')).toBe(2);
	});

	it('連続5日', async () => {
		addBonus(1, '2026-02-16');
		addBonus(1, '2026-02-17');
		addBonus(1, '2026-02-18');
		addBonus(1, '2026-02-19');
		addBonus(1, '2026-02-20');
		expect(await calculateConsecutiveDays(1, '2026-02-21', 'test-tenant')).toBe(6);
	});

	it('途切れた場合は1日', async () => {
		addBonus(1, '2026-02-18'); // 3日前
		// 2/19, 2/20 なし
		expect(await calculateConsecutiveDays(1, '2026-02-21', 'test-tenant')).toBe(1);
	});
});

// ============================================================
// getLoginBonusStatus
// ============================================================
describe('getLoginBonusStatus', () => {
	beforeEach(() => {
		seedChild();
		mockToday = '2026-03-10';
	});

	it('存在しない子供IDでNOT_FOUNDエラー', async () => {
		const result = await getLoginBonusStatus(999, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('未受取の場合claimedTodayがfalse', async () => {
		const result = await getLoginBonusStatus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.childId).toBe(1);
			expect(result.claimedToday).toBe(false);
			expect(result.consecutiveLoginDays).toBe(1);
			expect(result.lastClaimedAt).toBeNull();
		}
	});

	it('今日受取済みの場合claimedTodayがtrue', async () => {
		addBonus(1, '2026-03-10', 3);
		const result = await getLoginBonusStatus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.claimedToday).toBe(true);
			expect(result.consecutiveLoginDays).toBe(3);
		}
	});

	it('過去にボーナスがある場合lastClaimedAtが返る', async () => {
		addBonus(1, '2026-03-09', 2);
		const result = await getLoginBonusStatus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.claimedToday).toBe(false);
			expect(result.lastClaimedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
			// 昨日(03/09)のボーナスがあるので、今日を含めて2日連続
			expect(result.consecutiveLoginDays).toBe(2);
		}
	});

	it('連続が途切れた場合は1日目として返る', async () => {
		addBonus(1, '2026-03-07', 5); // 3日前 → 途切れ
		const result = await getLoginBonusStatus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.claimedToday).toBe(false);
			expect(result.consecutiveLoginDays).toBe(1);
		}
	});
});

// ============================================================
// claimLoginBonus
// ============================================================
describe('claimLoginBonus', () => {
	beforeEach(() => {
		seedChild();
		mockToday = '2026-03-10';
	});

	it('存在しない子供IDでNOT_FOUNDエラー', async () => {
		const result = await claimLoginBonus(999, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('既に受取済みの場合ALREADY_CLAIMEDエラー', async () => {
		addBonus(1, '2026-03-10');
		const result = await claimLoginBonus(1, 'test-tenant');
		expect(result).toEqual({ error: 'ALREADY_CLAIMED' });
	});

	it('初回ログインボーナス受取（倍率なし）', async () => {
		// Math.random を制御して「吉」(weight=34, basePoints=3) を確定
		// OMIKUJI_RANKS: 大大吉(1), 大吉(5), 中吉(15), 小吉(25), 吉(34), 末吉(20)
		// 累積: 1, 6, 21, 46, 80, 100
		// random=50 → 50-1=49, 49-5=44, 44-15=29, 29-25=4, 4-34=-30 ≤ 0 → 吉
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

		const result = await claimLoginBonus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.childId).toBe(1);
			expect(result.rank).toBe('吉');
			expect(result.basePoints).toBe(3);
			expect(result.consecutiveLoginDays).toBe(1);
			expect(result.multiplier).toBe(1.0);
			expect(result.totalPoints).toBe(3);
			expect(result.message).toBe('吉！3ポイントゲット！');
		}

		randomSpy.mockRestore();
	});

	it('連続ログインで倍率付きボーナス受取', async () => {
		// 2日分の過去ボーナスを追加 → 今日で3日連続 → 1.5倍
		addBonus(1, '2026-03-08', 1);
		addBonus(1, '2026-03-09', 2);

		// Math.random を制御して「中吉」(basePoints=7) を確定
		// 累積: 大大吉(1), 大吉(6), 中吉(21)
		// random=15 → 15-1=14, 14-5=9, 9-15=-6 ≤ 0 → 中吉
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.15);

		const result = await claimLoginBonus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.rank).toBe('中吉');
			expect(result.basePoints).toBe(7);
			expect(result.consecutiveLoginDays).toBe(3);
			expect(result.multiplier).toBe(1.5);
			expect(result.totalPoints).toBe(10); // floor(7 * 1.5) = 10
			expect(result.message).toContain('3にちれんぞくで1.5ばい');
			expect(result.message).toContain('10ポイントゲット');
		}

		randomSpy.mockRestore();
	});

	it('ボーナス受取後にDBにレコードが保存される', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

		await claimLoginBonus(1, 'test-tenant');

		// login_bonuses テーブルにレコードがあるか確認
		const bonuses = testDb.select().from(schema.loginBonuses).all();
		expect(bonuses.length).toBe(1);
		expect(bonuses[0]?.loginDate).toBe('2026-03-10');
		expect(bonuses[0]?.childId).toBe(1);

		// point_ledger テーブルにレコードがあるか確認
		const points = testDb.select().from(schema.pointLedger).all();
		expect(points.length).toBe(1);
		expect(points[0]?.type).toBe('login_bonus');
		expect(points[0]?.childId).toBe(1);

		randomSpy.mockRestore();
	});

	it('7日連続で2.0倍のメッセージ', async () => {
		// 6日分の過去ボーナスを追加
		for (let i = 3; i <= 8; i++) {
			const date = `2026-03-0${i}`;
			addBonus(1, date, i - 2);
		}
		addBonus(1, '2026-03-09', 7);

		// 大吉 (basePoints=15) を確定
		// random=3 → 3-1=2, 2-5=-3 ≤ 0 → 大吉
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.03);

		const result = await claimLoginBonus(1, 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.consecutiveLoginDays).toBe(8);
			expect(result.multiplier).toBe(2.0);
			expect(result.totalPoints).toBe(30); // floor(15 * 2.0) = 30
			expect(result.message).toContain('8にちれんぞくで2ばい');
		}

		randomSpy.mockRestore();
	});
});
