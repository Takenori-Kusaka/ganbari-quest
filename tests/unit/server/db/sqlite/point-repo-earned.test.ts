// tests/unit/server/db/sqlite/point-repo-earned.test.ts
// #4697: 月次レポート / 成長記録ブックの「ポイント」= 台帳のその月の獲得合計。
//
// 旧実装はこの値を持たず、`statuses.total_xp` の累計を「ポイント」として出していたため、
// 子供画面の所持ポイントとも週次タブの当週獲得とも一致せず、累計なので先月比が常に ±0 だった。
// 本テストは repo の集計契約 (期間 / 正の amount のみ / 子供ごと) を固定する。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { jstDateOfIso, monthEndOfKey } from '$lib/domain/date-utils';
import { asChildId } from '$lib/domain/ids';
import * as schema from '../../../../../src/lib/server/db/schema';
import {
	expectedEarnedInJstMonth,
	POINT_MONTH_BOUNDARY_MONTHS,
	POINT_MONTH_BOUNDARY_ROWS,
} from '../../../../helpers/point-month-boundary-fixture';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../../../helpers/test-db';

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

import { sumEarnedPointsBetween } from '../../../../../src/lib/server/db/sqlite/point-repo';

const TENANT = 'test-tenant';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

/** 台帳へ 1 行入れる。`created_at` は日付境界の検証用に明示指定する。 */
function ledger(childId: number, amount: number, createdAt: string, type = 'activity') {
	testDb
		.insert(schema.pointLedger)
		.values({ childId, amount, type, description: 'test', createdAt })
		.run();
}

describe('sqlite/point-repo sumEarnedPointsBetween (#4697)', () => {
	beforeEach(() => {
		resetAllTables(sqlite);
		testDb.insert(schema.children).values({ nickname: 'たろう', age: 7, theme: 'sky' }).run();
		testDb.insert(schema.children).values({ nickname: 'はなこ', age: 5, theme: 'pink' }).run();
	});

	// 本 describe の `created_at` は JST 09:00〜24:00 (= UTC 00:00〜15:00) に置き、UTC 暦日と JST
	// 暦日が一致する時間帯だけを使う。境界の 9 時間 (JST 00:00〜09:00) は下の
	// 「JST 暦日で月が決まる」describe が専任で見る。
	it('期間内に獲得したポイントを合計する', async () => {
		ledger(1, 10, '2026-04-01T09:00:00Z');
		ledger(1, 25, '2026-04-15T09:00:00Z');
		ledger(1, 33, '2026-04-30T14:00:00Z');

		expect(await sumEarnedPointsBetween(asChildId(1), '2026-04-01', '2026-04-30', TENANT)).toBe(68);
	});

	it('消費 (負の amount) は差し引かない — 「獲得」の合計である', async () => {
		ledger(1, 100, '2026-04-05T09:00:00Z');
		ledger(1, -80, '2026-04-06T09:00:00Z', 'exchange');

		expect(await sumEarnedPointsBetween(asChildId(1), '2026-04-01', '2026-04-30', TENANT)).toBe(
			100,
		);
	});

	it('期間外の行は含めない (前月 / 翌月)', async () => {
		ledger(1, 500, '2026-03-31T10:00:00Z');
		ledger(1, 700, '2026-05-01T00:00:00Z');
		ledger(1, 7, '2026-04-10T09:00:00Z');

		expect(await sumEarnedPointsBetween(asChildId(1), '2026-04-01', '2026-04-30', TENANT)).toBe(7);
	});

	it('月末当日の行を取りこぼさない (endDate は含む)', async () => {
		ledger(1, 12, '2026-04-30T00:00:00Z');

		expect(await sumEarnedPointsBetween(asChildId(1), '2026-04-01', '2026-04-30', TENANT)).toBe(12);
	});

	it('他の子供の行を混ぜない', async () => {
		ledger(1, 10, '2026-04-10T09:00:00Z');
		ledger(2, 999, '2026-04-10T09:00:00Z');

		expect(await sumEarnedPointsBetween(asChildId(1), '2026-04-01', '2026-04-30', TENANT)).toBe(10);
		expect(await sumEarnedPointsBetween(asChildId(2), '2026-04-01', '2026-04-30', TENANT)).toBe(
			999,
		);
	});

	it('該当行が無ければ 0 (null にしない)', async () => {
		expect(await sumEarnedPointsBetween(asChildId(1), '2026-04-01', '2026-04-30', TENANT)).toBe(0);
	});

	it('月が違えば違う数を返す (先月比が意味を持つ)', async () => {
		ledger(1, 30, '2026-03-10T09:00:00Z');
		ledger(1, 95, '2026-04-10T09:00:00Z');

		const march = await sumEarnedPointsBetween(asChildId(1), '2026-03-01', '2026-03-31', TENANT);
		const april = await sumEarnedPointsBetween(asChildId(1), '2026-04-01', '2026-04-30', TENANT);

		expect(march).toBe(30);
		expect(april).toBe(95);
	});
});

// #4697 follow-up: 月境界は **JST 暦日**で決まる (interface の契約 / date-utils SSOT 宣言)。
// `created_at` は UTC なので、その日付を前方一致で使うと JST 00:00〜09:00 の 9 時間が前日側に
// 落ち、pg-core backend (recorded_date = 書込時の JST 今日で絞る) と帰属月が食い違う。
// 同じ fixture を pg-core 側 (tests/integration/db/point-month-boundary-parity.test.ts) からも
// 読み、両 backend が同じ月に同じ額を返すことを表明する。
describe('sqlite/point-repo sumEarnedPointsBetween — JST 暦日で月が決まる (#4697)', () => {
	beforeEach(() => {
		resetAllTables(sqlite);
		testDb.insert(schema.children).values({ nickname: 'たろう', age: 7, theme: 'sky' }).run();
		for (const row of POINT_MONTH_BOUNDARY_ROWS) {
			ledger(1, row.amount, row.createdAtUtcIso);
		}
	});

	it('fixture の JST 月の宣言が date-utils の導出と一致する', () => {
		for (const row of POINT_MONTH_BOUNDARY_ROWS) {
			expect(jstDateOfIso(row.createdAtUtcIso).slice(0, 7), row.label).toBe(row.jstMonth);
		}
	});

	it.each(POINT_MONTH_BOUNDARY_MONTHS)('%s の獲得合計が JST 暦月と一致する', async (monthKey) => {
		const total = await sumEarnedPointsBetween(
			asChildId(1),
			`${monthKey}-01`,
			monthEndOfKey(monthKey),
			TENANT,
		);

		expect(total).toBe(expectedEarnedInJstMonth(monthKey));
	});

	it('JST 00:00〜09:00 の獲得を隣の月に取りこぼさない (合計が保存される)', async () => {
		const totals = await Promise.all(
			POINT_MONTH_BOUNDARY_MONTHS.map((monthKey) =>
				sumEarnedPointsBetween(asChildId(1), `${monthKey}-01`, monthEndOfKey(monthKey), TENANT),
			),
		);

		// どの月にも 1 円も落ちない = 3 ヶ月の合計が投入した全額に一致する
		expect(totals.reduce((a, b) => a + b, 0)).toBe(
			POINT_MONTH_BOUNDARY_ROWS.reduce((sum, r) => sum + r.amount, 0),
		);
	});
});
