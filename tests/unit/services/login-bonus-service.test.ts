import { asChildId } from '$lib/domain/ids';
// tests/unit/services/login-bonus-service.test.ts
// ログインボーナスサービスのユニットテスト (#3330 案 B counter 縮約)
//
// per-date 行 (旧 login_bonuses) は廃止。counter (login_streaks: lastLoginDate + currentStreak)
// に対する status 導出 / claim (conditional write) / 二重 claim 拒否 / point_ledger 単一記帳を検証。
// UI から見える観測契約 (claimedToday / consecutiveLoginDays / 倍率 / message) は旧実装と不変。

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
vi.mock('$lib/domain/date-utils', async (importOriginal) => ({
	// 部分 mock。今日だけを固定し、他の JST ヘルパは実装をそのまま使う (#4127)
	...(await importOriginal<typeof import('$lib/domain/date-utils')>()),
	todayDateJST: () => mockToday,
}));

import {
	calcLoginBonusPoints,
	deriveConsecutiveDays,
	deriveStreakCounter,
	drawOmikuji,
	getLoginMultiplier,
	OMIKUJI_RANKS,
} from '../../../src/lib/domain/validation/login-bonus';
import {
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

/** counter 状態を直接 seed する (#3330: per-date 行の代わり) */
function seedStreak(childId: number, lastLoginDate: string, currentStreak: number) {
	testDb.insert(schema.loginStreaks).values({ childId, lastLoginDate, currentStreak }).run();
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

// ============================================================
// deriveStreakCounter / deriveConsecutiveDays (#3330 fold / 導出 helper)
// ============================================================
describe('deriveStreakCounter (旧 per-date → counter fold)', () => {
	it('空集合は null', () => {
		expect(deriveStreakCounter([])).toBeNull();
	});

	it('単日は streak 1', () => {
		expect(deriveStreakCounter(['2026-02-21'])).toEqual({
			lastLoginDate: '2026-02-21',
			currentStreak: 1,
		});
	});

	it('連続 5 日 (順不同・重複あり) を最新日から数える', () => {
		expect(
			deriveStreakCounter([
				'2026-02-18',
				'2026-02-16',
				'2026-02-20',
				'2026-02-17',
				'2026-02-19',
				'2026-02-19', // 重複は無視
			]),
		).toEqual({ lastLoginDate: '2026-02-20', currentStreak: 5 });
	});

	it('途切れがあれば最新 run のみ数える (旧 calculateConsecutiveDays と同一論理)', () => {
		expect(deriveStreakCounter(['2026-02-10', '2026-02-11', '2026-02-14', '2026-02-15'])).toEqual({
			lastLoginDate: '2026-02-15',
			currentStreak: 2,
		});
	});
});

describe('deriveConsecutiveDays (status 表示用の導出)', () => {
	it('counter 無しは 1 (初回)', () => {
		expect(deriveConsecutiveDays(null, '2026-03-10')).toBe(1);
	});

	it('当日 claim 済は currentStreak 据置', () => {
		expect(
			deriveConsecutiveDays({ lastLoginDate: '2026-03-10', currentStreak: 3 }, '2026-03-10'),
		).toBe(3);
	});

	it('昨日まで連続なら +1 (今日 claim すると何日目か)', () => {
		expect(
			deriveConsecutiveDays({ lastLoginDate: '2026-03-09', currentStreak: 2 }, '2026-03-10'),
		).toBe(3);
	});

	it('途切れていれば 1', () => {
		expect(
			deriveConsecutiveDays({ lastLoginDate: '2026-03-07', currentStreak: 5 }, '2026-03-10'),
		).toBe(1);
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
		const result = await getLoginBonusStatus(asChildId(999), 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('未受取の場合claimedTodayがfalse', async () => {
		const result = await getLoginBonusStatus(asChildId(1), 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.childId).toBe('1');
			expect(result.claimedToday).toBe(false);
			expect(result.consecutiveLoginDays).toBe(1);
			expect(result.lastClaimedAt).toBeNull();
		}
	});

	it('今日受取済みの場合claimedTodayがtrue', async () => {
		seedStreak(1, '2026-03-10', 3);
		const result = await getLoginBonusStatus(asChildId(1), 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.claimedToday).toBe(true);
			expect(result.consecutiveLoginDays).toBe(3);
		}
	});

	it('昨日まで連続の場合lastClaimedAtが返り、今日を含めた連続日数になる', async () => {
		seedStreak(1, '2026-03-09', 1);
		const result = await getLoginBonusStatus(asChildId(1), 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.claimedToday).toBe(false);
			expect(result.lastClaimedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
			// 昨日(03/09)まで 1 日連続 → 今日を含めて 2 日連続
			expect(result.consecutiveLoginDays).toBe(2);
		}
	});

	it('連続が途切れた場合は1日目として返る', async () => {
		seedStreak(1, '2026-03-07', 5); // 3日前 → 途切れ
		const result = await getLoginBonusStatus(asChildId(1), 'test-tenant');
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
		const result = await claimLoginBonus(asChildId(999), 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('既に受取済みの場合ALREADY_CLAIMEDエラー', async () => {
		seedStreak(1, '2026-03-10', 1);
		const result = await claimLoginBonus(asChildId(1), 'test-tenant');
		expect(result).toEqual({ error: 'ALREADY_CLAIMED' });
	});

	it('初回ログインボーナス受取（倍率なし）', async () => {
		// Math.random を制御して「吉」(weight=34, basePoints=3) を確定
		// OMIKUJI_RANKS: 大大吉(1), 大吉(5), 中吉(15), 小吉(25), 吉(34), 末吉(20)
		// 累積: 1, 6, 21, 46, 80, 100
		// random=50 → 50-1=49, 49-5=44, 44-15=29, 29-25=4, 4-34=-30 ≤ 0 → 吉
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

		const result = await claimLoginBonus(asChildId(1), 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.childId).toBe('1');
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
		// 昨日まで 2 日連続の counter → 今日で3日連続 → 1.5倍
		seedStreak(1, '2026-03-09', 2);

		// Math.random を制御して「中吉」(basePoints=7) を確定
		// 累積: 大大吉(1), 大吉(6), 中吉(21)
		// random=15 → 15-1=14, 14-5=9, 9-15=-6 ≤ 0 → 中吉
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.15);

		const result = await claimLoginBonus(asChildId(1), 'test-tenant');
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

	it('ボーナス受取後にcounterが更新されpoint_ledgerに1件だけ記帳される', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

		await claimLoginBonus(asChildId(1), 'test-tenant');

		// login_streaks に counter 1 行 (per-date 行は作られない)
		const streaks = testDb.select().from(schema.loginStreaks).all();
		expect(streaks.length).toBe(1);
		expect(streaks[0]?.lastLoginDate).toBe('2026-03-10');
		expect(streaks[0]?.currentStreak).toBe(1);
		expect(streaks[0]?.childId).toBe(1);

		// point_ledger テーブルにレコードがあるか確認
		const points = testDb.select().from(schema.pointLedger).all();
		expect(points.length).toBe(1);
		expect(points[0]?.type).toBe('login_bonus');
		expect(points[0]?.childId).toBe(1);

		randomSpy.mockRestore();
	});

	it('二重 claim (同時 2 連発) は 1 回のみ加点される (conditional write 冪等、ADR-0061)', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

		const [r1, r2] = await Promise.all([
			claimLoginBonus(asChildId(1), 'test-tenant'),
			claimLoginBonus(asChildId(1), 'test-tenant'),
		]);
		const winners = [r1, r2].filter((r) => !('error' in r));
		const losers = [r1, r2].filter((r) => 'error' in r);
		expect(winners.length).toBe(1);
		expect(losers).toEqual([{ error: 'ALREADY_CLAIMED' }]);

		// counter 1 行 / point_ledger 1 件のみ (二重加点なし)
		expect(testDb.select().from(schema.loginStreaks).all().length).toBe(1);
		expect(testDb.select().from(schema.pointLedger).all().length).toBe(1);

		randomSpy.mockRestore();
	});

	it('7日連続で2.0倍のメッセージ', async () => {
		// 昨日まで 7 日連続の counter → 今日で 8 日連続
		seedStreak(1, '2026-03-09', 7);

		// 大吉 (basePoints=15) を確定
		// random=3 → 3-1=2, 2-5=-3 ≤ 0 → 大吉
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.03);

		const result = await claimLoginBonus(asChildId(1), 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.consecutiveLoginDays).toBe(8);
			expect(result.multiplier).toBe(2.0);
			expect(result.totalPoints).toBe(30); // floor(15 * 2.0) = 30
			expect(result.message).toContain('8にちれんぞくで2ばい');
		}

		randomSpy.mockRestore();
	});

	it('途切れ後の claim は streak 1 にリセットされる', async () => {
		seedStreak(1, '2026-03-07', 10); // 3日前 → 途切れ
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

		const result = await claimLoginBonus(asChildId(1), 'test-tenant');
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.consecutiveLoginDays).toBe(1);
			expect(result.multiplier).toBe(1.0);
		}
		const streaks = testDb.select().from(schema.loginStreaks).all();
		expect(streaks[0]?.currentStreak).toBe(1);
		expect(streaks[0]?.lastLoginDate).toBe('2026-03-10');

		randomSpy.mockRestore();
	});
});
