// tests/unit/db/sqlite-jst-day-boundary.test.ts
// #4722: sqlite の「今日」判定を JST 暦日に揃えた回帰 (実 DB で振る舞いを固定する)。
//
// 実害: 保存値は UTC (ISO 文字列 / CURRENT_TIMESTAMP) なのに、比較相手は `todayDateJST()` が返す
// **JST 暦日**だった。JST 00:00〜09:00 (= UTC の前日 15:00〜24:00) では両者が 1 日ずれ、
//   - ステータス減衰: 「今日はまだ減衰していない」と誤判定して 1 日 2 回減衰しうる
//   - おやくそく全達成ボーナス: 当日冪等の判定が外れて二重付与しうる
// が起きる。dsql 側は既に JST 判定 (`AT TIME ZONE 'Asia/Tokyo'`) なので backend 間でも割れていた。
//
// (おうえん当日回数も同じ class だったが、#4691 で「きょうだい間おうえん」機能ごと撤去され
//  `countTodayCheersFrom` が消えたため、本 spec の対象は減衰 / 当日ボーナスの 2 件になる。)
//
// 検証は **JST 00:30 (= UTC 前日 15:30) に書かれた行**を「その JST 暦日の行」として数えられるか。
// SQL 側で `date(col, '+9 hours')` に揃えたため結果はプロセス TZ に依存しない (2 TZ で同値を確認)。

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let testDb: TestDb;
let sqlite: TestSqlite;

vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	getOrInitDb() {
		return testDb;
	},
}));

const t = createTestDb();
testDb = t.db;
sqlite = t.sqlite;

/** JST 2026-08-01 00:30 = UTC 2026-07-31 15:30 (JST 0〜9 時の窓、tz-invariance registry と同じ瞬間)。 */
const UTC_INSTANT = '2026-07-31T15:30:00.000Z';
const JST_DATE = '2026-08-01';
/** UTC 暦日 (旧実装が「今日」と誤認していた方の日付)。 */
const UTC_DATE = '2026-07-31';
const TENANT = 't-jst';
const TIMEZONES = ['UTC', 'Asia/Tokyo'];
const originalTz = process.env.TZ;

afterAll(() => {
	closeDb(sqlite);
	if (originalTz === undefined) delete process.env.TZ;
	else process.env.TZ = originalTz;
});

beforeEach(() => {
	resetDb(sqlite);
});

afterEach(() => {
	if (originalTz === undefined) delete process.env.TZ;
	else process.env.TZ = originalTz;
});

function seedChild(): number {
	testDb
		.insert(schema.children)
		.values({ nickname: 'きょうの子', age: 8, theme: 'blue', uiMode: 'elementary' })
		.run();
	return testDb.select().from(schema.children).all()[0]?.id ?? 0;
}

describe('#4722 sqlite の「今日」判定は JST 暦日 (UTC 保存値との 9 時間ずれを吸収する)', () => {
	for (const tz of TIMEZONES) {
		it(`TZ=${tz}: ステータス減衰の当日判定が JST 暦日で一致する`, async () => {
			process.env.TZ = tz;
			const childId = seedChild();
			testDb
				.insert(schema.statusHistory)
				.values({
					childId,
					categoryId: 3,
					value: 9,
					changeAmount: -1,
					changeType: 'daily_decay',
					recordedAt: UTC_INSTANT,
				})
				.run();

			const { hasDecayRunToday } = await import(
				'../../../src/lib/server/db/sqlite/evaluation-repo'
			);
			// JST 暦日で「今日実行済み」と判定できる (旧実装は false = 二重減衰)
			expect(await hasDecayRunToday(childId as never, JST_DATE, TENANT)).toBe(true);
			// UTC 暦日では一致しない (JST に寄せたことの裏返し)
			expect(await hasDecayRunToday(childId as never, UTC_DATE, TENANT)).toBe(false);
		});

		it(`TZ=${tz}: 当日ボーナスの冪等判定 (point_ledger) が JST 暦日で一致する`, async () => {
			process.env.TZ = tz;
			const childId = seedChild();
			// created_at は CURRENT_TIMESTAMP (UTC 'YYYY-MM-DD HH:MM:SS') 形式でも入るため両形式を入れる
			testDb
				.insert(schema.pointLedger)
				.values([
					{
						childId,
						amount: 10,
						type: 'must_bonus',
						description: 'おやくそく全達成',
						createdAt: UTC_INSTANT,
					},
					{
						childId,
						amount: 10,
						type: 'must_bonus',
						description: 'おやくそく全達成 (CURRENT_TIMESTAMP 形式)',
						createdAt: '2026-07-31 15:40:00',
					},
				])
				.run();

			const { countPointLedgerEntriesByTypeAndDate } = await import(
				'../../../src/lib/server/db/sqlite/activity-repo'
			);
			expect(
				await countPointLedgerEntriesByTypeAndDate(
					childId as never,
					'must_bonus',
					JST_DATE,
					TENANT,
				),
			).toBe(2);
			expect(
				await countPointLedgerEntriesByTypeAndDate(
					childId as never,
					'must_bonus',
					UTC_DATE,
					TENANT,
				),
			).toBe(0);
		});
	}
});
