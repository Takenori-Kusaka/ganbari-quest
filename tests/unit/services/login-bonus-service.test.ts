// tests/unit/services/login-bonus-service.test.ts
// ログインボーナスサービスのユニットテスト

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

import {
	OMIKUJI_RANKS,
	calcLoginBonusPoints,
	drawOmikuji,
	getLoginMultiplier,
} from '../../../src/lib/domain/validation/login-bonus';
import { calculateConsecutiveDays } from '../../../src/lib/server/services/login-bonus-service';

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
