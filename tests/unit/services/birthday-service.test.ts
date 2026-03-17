// tests/unit/services/birthday-service.test.ts
// 誕生日イベント・振り返り機能のユニットテスト

import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
		active_title_id INTEGER,
		active_avatar_bg INTEGER,
		active_avatar_frame INTEGER,
		active_avatar_effect INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE birthday_reviews (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		review_year INTEGER NOT NULL,
		age_at_review INTEGER NOT NULL,
		health_checks TEXT NOT NULL DEFAULT '{}',
		aspiration_text TEXT,
		aspiration_categories TEXT NOT NULL DEFAULT '{}',
		base_points INTEGER NOT NULL DEFAULT 0,
		health_points INTEGER NOT NULL DEFAULT 0,
		aspiration_points INTEGER NOT NULL DEFAULT 0,
		total_points INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_birthday_reviews_unique
		ON birthday_reviews(child_id, review_year);
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

// Mock date-utils to control "today"
let mockToday = '2026-03-08';
vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => mockToday,
	prevDateJST: (dateStr: string) => {
		const d = new Date(`${dateStr}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - 1);
		return d.toISOString().slice(0, 10);
	},
}));

import {
	HEALTH_CHECK_ITEMS,
	checkBirthdayStatus,
	getBirthdayReviews,
	submitBirthdayReview,
} from '../../../src/lib/server/services/birthday-service';

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
	sqlite.exec('DELETE FROM birthday_reviews');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children', 'birthday_reviews', 'point_ledger')",
	);
}

function seedChild(birthDate: string | null = '2022-03-08', age = 4) {
	testDb
		.insert(schema.children)
		.values({ nickname: 'テストちゃん', age, birthDate, theme: 'pink' })
		.run();
	return 1;
}

describe('checkBirthdayStatus', () => {
	beforeEach(() => {
		resetDb();
		mockToday = '2026-03-08';
	});

	it('存在しない子供でNOT_FOUNDエラーを返す', () => {
		const result = checkBirthdayStatus(999);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('birthDateがnullならisBirthday=false', () => {
		seedChild(null);
		const result = checkBirthdayStatus(1);
		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.isBirthday).toBe(false);
		}
	});

	it('誕生日当日ならisBirthday=true', () => {
		seedChild('2022-03-08'); // Today is 2026-03-08
		const result = checkBirthdayStatus(1);
		if (!('error' in result)) {
			expect(result.isBirthday).toBe(true);
			expect(result.alreadyReviewed).toBe(false);
		}
	});

	it('誕生日から3日以内ならisBirthday=true (猶予期間)', () => {
		seedChild('2022-03-06'); // Birthday was Mar 6, today is Mar 8 (2 days later)
		const result = checkBirthdayStatus(1);
		if (!('error' in result)) {
			expect(result.isBirthday).toBe(true);
		}
	});

	it('誕生日から4日後ならisBirthday=false (猶予期間超過)', () => {
		seedChild('2022-03-04'); // Birthday was Mar 4, today is Mar 8 (4 days later)
		const result = checkBirthdayStatus(1);
		if (!('error' in result)) {
			expect(result.isBirthday).toBe(false);
		}
	});

	it('誕生日前ならisBirthday=falseで残り日数を返す', () => {
		seedChild('2022-03-15'); // Birthday is Mar 15, today is Mar 8
		const result = checkBirthdayStatus(1);
		if (!('error' in result)) {
			expect(result.isBirthday).toBe(false);
			expect(result.daysUntilBirthday).toBe(7);
		}
	});

	it('既にレビュー済みならalreadyReviewed=true', () => {
		seedChild('2022-03-08');
		testDb
			.insert(schema.birthdayReviews)
			.values({
				childId: 1,
				reviewYear: 2026,
				ageAtReview: 4,
				healthChecks: '{}',
				basePoints: 400,
				healthPoints: 0,
				aspirationPoints: 0,
				totalPoints: 400,
			})
			.run();
		const result = checkBirthdayStatus(1);
		if (!('error' in result)) {
			expect(result.isBirthday).toBe(true);
			expect(result.alreadyReviewed).toBe(true);
		}
	});
});

describe('submitBirthdayReview', () => {
	beforeEach(() => {
		resetDb();
		mockToday = '2026-03-08';
	});

	it('存在しない子供でNOT_FOUNDを返す', () => {
		const result = submitBirthdayReview(999, { healthChecks: {} });
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('全項目チェック + 目標テキストで最大ポイントを付与', () => {
		seedChild('2022-03-08', 4);
		const allChecks: Record<string, boolean> = {};
		for (const item of HEALTH_CHECK_ITEMS) {
			allChecks[item.key] = true;
		}

		const result = submitBirthdayReview(1, {
			healthChecks: allChecks,
			aspirationText: 'おおきくなったらパイロットになりたい',
		});

		if (!('error' in result)) {
			// base: 4 * 100 = 400
			// health: 5 * 50 + 100 (all clear) = 350
			// aspiration: 200 (text)
			// total: 950
			expect(result.basePoints).toBe(400);
			expect(result.healthPoints).toBe(350);
			expect(result.aspirationPoints).toBe(200);
			expect(result.totalPoints).toBe(950);
		} else {
			expect.unreachable('Should not return error');
		}
	});

	it('チェック一部 + カテゴリ選択で適切なポイント', () => {
		seedChild('2022-03-08', 5);
		const result = submitBirthdayReview(1, {
			healthChecks: { no_injury: true, no_cold: true },
			aspirationCategories: { category1: 'うんどう' },
		});

		if (!('error' in result)) {
			// base: 5 * 100 = 500
			// health: 2 * 50 = 100 (no all-clear bonus)
			// aspiration: 100 (select)
			// total: 700
			expect(result.basePoints).toBe(500);
			expect(result.healthPoints).toBe(100);
			expect(result.aspirationPoints).toBe(100);
			expect(result.totalPoints).toBe(700);
		}
	});

	it('チェックなし・目標なしでも基本ポイントを付与', () => {
		seedChild('2022-03-08', 3);
		const result = submitBirthdayReview(1, { healthChecks: {} });

		if (!('error' in result)) {
			expect(result.basePoints).toBe(300);
			expect(result.healthPoints).toBe(0);
			expect(result.aspirationPoints).toBe(0);
			expect(result.totalPoints).toBe(300);
		}
	});

	it('ポイント台帳にbirthday_bonusタイプで記録される', () => {
		seedChild('2022-03-08', 4);
		submitBirthdayReview(1, { healthChecks: { no_injury: true } });

		const ledger = testDb
			.select()
			.from(schema.pointLedger)
			.where(eq(schema.pointLedger.type, 'birthday_bonus'))
			.all();
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.type).toBe('birthday_bonus');
		expect(ledger[0]?.amount).toBeGreaterThan(0);
	});

	it('同年の二重レビューはALREADY_REVIEWEDエラー', () => {
		seedChild('2022-03-08', 4);
		submitBirthdayReview(1, { healthChecks: {} });
		const result = submitBirthdayReview(1, { healthChecks: {} });
		expect(result).toEqual({ error: 'ALREADY_REVIEWED' });
	});
});

describe('getBirthdayReviews', () => {
	beforeEach(() => {
		resetDb();
	});

	it('レビュー履歴を年順に返す', () => {
		seedChild('2022-03-08', 4);
		testDb
			.insert(schema.birthdayReviews)
			.values([
				{ childId: 1, reviewYear: 2025, ageAtReview: 3, basePoints: 300, totalPoints: 300 },
				{ childId: 1, reviewYear: 2026, ageAtReview: 4, basePoints: 400, totalPoints: 400 },
			])
			.run();

		const reviews = getBirthdayReviews(1);
		expect(reviews).toHaveLength(2);
		expect(reviews[0]?.reviewYear).toBe(2025);
		expect(reviews[1]?.reviewYear).toBe(2026);
	});

	it('レビューがなければ空配列を返す', () => {
		seedChild('2022-03-08', 4);
		const reviews = getBirthdayReviews(1);
		expect(reviews).toHaveLength(0);
	});
});
