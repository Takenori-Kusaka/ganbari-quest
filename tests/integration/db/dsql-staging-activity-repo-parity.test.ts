// tests/integration/db/dsql-staging-activity-repo-parity.test.ts
// #3596 ④ / EPIC #3424 §12.2 cutover — **実 Aurora DSQL cluster** での dormant IActivityRepo
// (activity-repo.ts、createDsqlActivityRepo) の tenant 述語 + 集計値 parity 統合検証。
//
// IActivityRepo は §P9 tenant 述語完備だが cutover 未結線の dormant repo であり、PGlite unit
// (dsql-activity-log-repo.test.ts [G1][G2][M1][T1]) では緑でも、本番相当 DSQL で「集計値ズレ
// (GROUP BY / LEFT JOIN の cancelled filter / NULL 埋めの sqlite facade parity) / tenant 述語
// 欠落」が cutover 初露見にならないよう、本番同型 cluster で最終確証する (#3550/#3593 同軸):
//
//   [V5-1] §P9 tenant 分離 (実 cluster): 他 family の activity / log は findActivities /
//          findActivityById / 集計 から不可視 (cross-tenant 行が結合されない)
//   [V5-2] getActivityLogCounts の cancelled filter parity: cancelled=true 行は集計から除外
//   [V5-3] findMustActivitiesWithToday の LEFT JOIN NULL 埋め parity: 今日 log 無し must は
//          loggedToday=0、有り must は 1。logged/total が正 (NULL 行を 0 で埋める)
//
// 実行方法 (CI では skip — DSQL_ENDPOINT 未設定のため。DbConnectAdmin 相当 credential 必要):
//   DSQL_ENDPOINT=<id>.dsql.us-east-1.on.aws npx vitest run tests/integration/db/dsql-staging-activity-repo-parity.test.ts
//
// 検証データは専用 family uuid に隔離し afterAll で全削除する (staging を汚さない)。

import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asActivityId, asChildId } from '../../../src/lib/domain/ids';
import { createDsqlActivityRepo } from '../../../src/lib/server/db/dsql/activity-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IActivityRepo } from '../../../src/lib/server/db/interfaces/activity-repo.interface';

const ENDPOINT = process.env.DSQL_ENDPOINT;
const FAMILY = '00000000-0000-4000-8000-00000000c05a'; // 検証専用 family (afterAll で全削除)
const OTHER_FAMILY = '00000000-0000-4000-8000-00000000c05b';
const TODAY = new Date().toISOString().slice(0, 10);

type Db = ReturnType<typeof drizzle>;

// #3596 ④ 恒久 opt-in skip: 実 DSQL cluster (DSQL_ENDPOINT + AWS creds) 前提のため CI では常時
// skip する設計 (deadline なし)。owner: @Takenori-Kusaka。実行方法は本ファイル冒頭コメント。
describe.skipIf(!ENDPOINT)(
	'実 DSQL staging dormant IActivityRepo parity 検証 (#3596 ④、cutover 前必須)',
	() => {
		let pool: AuroraDSQLPool;
		let db: Db;
		let repo: IActivityRepo;

		beforeAll(async () => {
			pool = new AuroraDSQLPool({
				host: ENDPOINT,
				user: process.env.DSQL_MIGRATE_USER ?? 'admin',
				database: 'postgres',
				max: 4,
				connectionTimeoutMillis: 15_000,
			});
			db = drizzle(pool);
			const runner = createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 10 });
			repo = createDsqlActivityRepo(db, runner);
		}, 60_000);

		afterAll(async () => {
			// 検証 2 family の全行を削除して staging を原状復帰する (family_id 隔離済み)
			for (const family of [FAMILY, OTHER_FAMILY]) {
				for (const table of ['activity_logs', 'child_activities', 'children']) {
					await db.execute(sql.raw(`DELETE FROM ${table} WHERE family_id = '${family}'`));
				}
			}
			await (pool as unknown as { end(): Promise<void> }).end(); // 型定義に end 無し (dsql-migrate.ts と同キャスト)
		}, 120_000);

		async function seedChild(family: string, nickname: string): Promise<string> {
			const childId = crypto.randomUUID();
			await db.execute(sql`
				INSERT INTO children (family_id, child_id, nickname)
				VALUES (${family}, ${childId}, ${nickname})
			`);
			return childId;
		}

		async function seedActivity(
			family: string,
			childId: string,
			opts: { name: string; priority?: 'must' | 'optional' },
		): Promise<string> {
			const r = await db.execute(sql`
				INSERT INTO child_activities
					(family_id, child_id, name, category_id, icon, base_points, priority,
					 is_main_quest, is_visible, is_archived, sort_order)
				VALUES (${family}, ${childId}, ${opts.name}, 'exercise', '🏃', 5,
					${opts.priority ?? 'optional'}, false, true, false, 0)
				RETURNING activity_id
			`);
			return (r.rows[0] as { activity_id: string }).activity_id;
		}

		async function seedLog(
			family: string,
			childId: string,
			activityId: string,
			opts: { date: string; cancelled?: boolean },
		): Promise<void> {
			await db.execute(sql`
				INSERT INTO activity_logs
					(family_id, child_id, activity_id, points, recorded_date, recorded_at, cancelled)
				VALUES (${family}, ${childId}, ${activityId}, 10, ${opts.date},
					${`${opts.date}T09:00:00.000Z`}, ${opts.cancelled ?? false})
			`);
		}

		it('[V5-1] §P9 tenant 分離 (実 cluster): 他 family の activity / log は不可視', async () => {
			const child = await seedChild(FAMILY, '自分の子');
			const otherChild = await seedChild(OTHER_FAMILY, '他家の子');
			const mine = await seedActivity(FAMILY, child, { name: 'じぶん' });
			const others = await seedActivity(OTHER_FAMILY, otherChild, { name: 'たにん' });

			// findActivities は自 family の行のみ (他 family の 'たにん' は混入しない)
			const listed = await repo.findActivities(FAMILY);
			const names = listed.map((a) => a.name);
			expect(names).toContain('じぶん');
			expect(names).not.toContain('たにん');

			// 他 family の activity_id を自 family scope で findActivityById → undefined
			expect(await repo.findActivityById(asActivityId(others), FAMILY)).toBeUndefined();
			// 自 family の activity_id は取得できる (armed 証明)
			expect(await repo.findActivityById(asActivityId(mine), FAMILY)).toBeDefined();
		}, 60_000);

		it('[V5-2] getActivityLogCounts の cancelled filter parity: cancelled 行は集計除外', async () => {
			const child = await seedChild(FAMILY, 'カウント子');
			const act = await seedActivity(FAMILY, child, { name: 'かうんと' });
			await seedLog(FAMILY, child, act, { date: TODAY });
			await seedLog(FAMILY, child, act, { date: TODAY });
			await seedLog(FAMILY, child, act, { date: TODAY, cancelled: true }); // 除外対象

			const counts = await repo.getActivityLogCounts(FAMILY);
			// cancelled=true の 1 件を除いた 2 件のみ (NULL/cancelled 混在の集計 parity)
			expect(counts[act]).toBe(2);
			// countTodayActiveRecords も同じ cancelled 除外契約
			expect(
				await repo.countTodayActiveRecords(asChildId(child), asActivityId(act), TODAY, FAMILY),
			).toBe(2);
		}, 60_000);

		it('[V5-3] findMustActivitiesWithToday の LEFT JOIN NULL 埋め parity', async () => {
			const child = await seedChild(FAMILY, 'ミッション子');
			const loggedAct = await seedActivity(FAMILY, child, { name: 'すみ', priority: 'must' });
			const notLoggedAct = await seedActivity(FAMILY, child, { name: 'まだ', priority: 'must' });
			// loggedAct のみ今日 log あり。notLoggedAct は今日 log 無し (LEFT JOIN で NULL → 0 埋め)
			await seedLog(FAMILY, child, loggedAct, { date: TODAY });
			// cancelled log は「未達成」扱い (loggedToday=0 に寄与しない = 集計から除外)
			await seedLog(FAMILY, child, notLoggedAct, { date: TODAY, cancelled: true });

			const result = await repo.findMustActivitiesWithToday(asChildId(child), TODAY, FAMILY);
			expect(result.total).toBe(2);
			expect(result.logged).toBe(1); // loggedAct のみ
			const byId = new Map(result.activities.map((a) => [String(a.id), a.loggedToday]));
			expect(byId.get(loggedAct)).toBe(1);
			expect(byId.get(notLoggedAct)).toBe(0); // NULL 埋め + cancelled 除外
		}, 60_000);
	},
);
