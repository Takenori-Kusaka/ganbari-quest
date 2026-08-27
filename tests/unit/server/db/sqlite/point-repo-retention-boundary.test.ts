// tests/unit/server/db/sqlite/point-repo-retention-boundary.test.ts
// #4697 follow-up (#717 / #729 / #3593 ②): 保持期間の cutoff も **JST 暦日の 0:00** で切る。
//
// `getHistoryCutoffDate` は JST 当日境界の date を返し、その downstream である
// `deletePointLedgerBeforeDate` は「これを JST 深夜 0:00 の instant として解釈する」ことを
// interface で約束している。UTC の暦日で切ると cutoff 当日の JST 00:00〜09:00 に記録された
// 明細が 1 日早く消える (DSQL 側は #3593 ② で是正済、sqlite 側だけ残っていた)。
// 過去明細が契約より早く消えるのは顧客から見て取り返しがつかないため、境界を直接固定する。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import * as schema from '../../../../../src/lib/server/db/schema';
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

import {
	deletePointLedgerBeforeDate,
	findPointHistory,
} from '../../../../../src/lib/server/db/sqlite/point-repo';

const TENANT = 'test-tenant';
const CUTOFF = '2026-04-01';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function ledger(amount: number, createdAt: string) {
	testDb
		.insert(schema.pointLedger)
		.values({ childId: 1, amount, type: 'activity', description: createdAt, createdAt })
		.run();
}

async function remainingDescriptions(): Promise<string[]> {
	const rows = await findPointHistory(asChildId(1), { limit: 100, offset: 0 }, TENANT);
	return rows.map((r) => r.description ?? '').sort();
}

describe('sqlite/point-repo deletePointLedgerBeforeDate — cutoff は JST 暦日の 0:00', () => {
	beforeEach(() => {
		resetAllTables(sqlite);
		testDb.insert(schema.children).values({ nickname: 'たろう', age: 7, theme: 'sky' }).run();
	});

	it('cutoff 当日の JST 00:00〜09:00 の明細を消さない (UTC ではまだ前日)', async () => {
		ledger(10, '2026-03-31T15:00:00Z'); // JST 2026-04-01 00:00 = cutoff 当日
		ledger(20, '2026-03-31T23:59:00Z'); // JST 2026-04-01 08:59 = cutoff 当日

		const deleted = await deletePointLedgerBeforeDate(asChildId(1), CUTOFF, TENANT);

		expect(deleted).toBe(0);
		expect(await remainingDescriptions()).toEqual(['2026-03-31T15:00:00Z', '2026-03-31T23:59:00Z']);
	});

	it('cutoff 前日 JST 23:59 までの明細は消す', async () => {
		ledger(30, '2026-03-31T14:59:00Z'); // JST 2026-03-31 23:59 = cutoff 前日
		ledger(40, '2026-03-01T09:00:00Z'); // JST 2026-03-01 18:00 = さらに前

		const deleted = await deletePointLedgerBeforeDate(asChildId(1), CUTOFF, TENANT);

		expect(deleted).toBe(2);
		expect(await remainingDescriptions()).toEqual([]);
	});

	it('cutoff 以降の明細を巻き込まない', async () => {
		ledger(50, '2026-03-31T14:59:00Z'); // 消える (cutoff 前日 JST 23:59)
		ledger(60, '2026-04-05T09:00:00Z'); // 残る
		ledger(70, '2026-04-30T23:00:00Z'); // 残る (JST 2026-05-01 08:00)

		const deleted = await deletePointLedgerBeforeDate(asChildId(1), CUTOFF, TENANT);

		expect(deleted).toBe(1);
		expect(await remainingDescriptions()).toEqual(['2026-04-05T09:00:00Z', '2026-04-30T23:00:00Z']);
	});

	it('`CURRENT_TIMESTAMP` 由来の空白区切り形式でも境界が壊れない', async () => {
		// 台帳の created_at は書き手によって形が違う (既定値は `YYYY-MM-DD HH:MM:SS`)。
		// 辞書順比較では `' '` < `'T'` で同一時刻の大小が入れ替わるため、形を跨いで固定する。
		ledger(80, '2026-03-31 15:00:00'); // JST 2026-04-01 00:00 = 残る
		ledger(90, '2026-03-31 14:59:00'); // JST 2026-03-31 23:59 = 消える

		const deleted = await deletePointLedgerBeforeDate(asChildId(1), CUTOFF, TENANT);

		expect(deleted).toBe(1);
		expect(await remainingDescriptions()).toEqual(['2026-03-31 15:00:00']);
	});
});
