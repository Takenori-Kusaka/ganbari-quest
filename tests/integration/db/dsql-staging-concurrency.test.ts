// tests/integration/db/dsql-staging-concurrency.test.ts
// #3545 / #3550 / EPIC #3424 — **実 Aurora DSQL cluster** での真の並行アクセス検証。
//
// PGlite (単一接続 WASM) では構造的に再現できない「複数接続からの同時 txn → commit 時
// OCC 40001 → withOccRetry → txn 内 re-read」の実挙動を、staging cluster への複数接続
// pool で実測する (cutover 前必須、#3545/#3550 の中核主張の実証):
//
//   [V1] OCC 実発生: retry なし runner で同一 child へ N 並行 → SQLSTATE 40001 が実際に
//        発生する (共有行 children.total_point / mastery / statuses の write-write を
//        DSQL adjudicator が commit 時検出する、という設計前提そのものの存在証明)
//   [V2] 冪等 guard (dailyLimit=1): retry 込み runner で N 並行 → ok:true はちょうど 1 件、
//        残りは ALREADY_RECORDED。point_ledger 1 行 / total_point 整合 (#3545 中核主張 =
//        連打・HTTP 再送での二重付与防止)
//   [V3] lost update なし (dailyLimit=0 無制限): N 並行全部 ok → mastery total_count = N /
//        total_point = N×points / ledger N 行 (re-read→upsert が OCC で直列化される実証、
//        #3550 ② core 整合)
//
// 実行方法 (CI では skip — DSQL_ENDPOINT 未設定のため。DbConnectAdmin 相当 credential 必要):
//   DSQL_ENDPOINT=<id>.dsql.us-east-1.on.aws npx vitest run tests/integration/db/dsql-staging-concurrency.test.ts
//
// 検証データは専用 family uuid に隔離し afterAll で全削除する (staging を汚さない)。

import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelActivityCore } from '../../../src/lib/server/db/dsql/cancel-activity-core';
import { isOccConflict } from '../../../src/lib/server/db/dsql/occ-retry';
import {
	type RecordActivityCoreInput,
	recordActivityCore,
} from '../../../src/lib/server/db/dsql/record-activity-core';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { TransactionRunner } from '../../../src/lib/server/db/interfaces/transaction.interface';

const ENDPOINT = process.env.DSQL_ENDPOINT;
const FAMILY = '00000000-0000-4000-8000-00000000c04c'; // 検証専用 family (afterAll で全削除)
const PARALLEL = 8;
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);

type Db = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function coreInput(
	childId: string,
	activityId: string,
	dailyLimit: number | null,
): RecordActivityCoreInput {
	return {
		familyId: FAMILY,
		childId,
		activityId,
		categoryId: 'undou',
		basePoints: 10,
		streakBonus: 0,
		masteryBonus: 0,
		streakDays: 1,
		recordedDate: TODAY,
		now: NOW,
		dailyLimit,
		description: 'staging 並行検証 (#3545)',
		changeType: 'activity_record',
		masteryLevelFor: (c) => Math.floor(c / 10) + 1,
		statusLevelFor: (xp) => Math.floor(xp / 100) + 1,
	};
}

// #3545 恒久 opt-in skip: 実 DSQL cluster (DSQL_ENDPOINT + AWS creds) が必要な staging 検証のため
// CI では常時 skip する設計 (deadline なし)。owner: @Takenori-Kusaka。実行方法は本ファイル冒頭コメント。
describe.skipIf(!ENDPOINT)('実 DSQL staging 並行アクセス検証 (#3545/#3550、cutover 前必須)', () => {
	let pool: AuroraDSQLPool;
	let db: Db;

	beforeAll(async () => {
		pool = new AuroraDSQLPool({
			host: ENDPOINT,
			user: process.env.DSQL_MIGRATE_USER ?? 'admin',
			database: 'postgres',
			max: PARALLEL + 2, // 並行 txn は接続 1:1 (DSQL は 1 接続 1 txn)
			connectionTimeoutMillis: 15_000,
		});
		db = drizzle(pool);
	}, 60_000);

	afterAll(async () => {
		// 検証 family の全行を削除して staging を原状復帰する (family_id 隔離済み)
		for (const table of [
			'status_history',
			'statuses',
			'point_ledger',
			'activity_mastery',
			'activity_logs',
			'children',
		]) {
			await db.execute(sql.raw(`DELETE FROM ${table} WHERE family_id = '${FAMILY}'`));
		}
		await (pool as unknown as { end(): Promise<void> }).end(); // 型定義に end 無し (dsql-migrate.ts と同キャスト)
	}, 120_000);

	async function seedChild(childId: string): Promise<void> {
		// children は age 列を持たない (§11.1 compute-on-read)。他列は default で埋まる。
		await db.execute(sql`
			INSERT INTO children (family_id, child_id, nickname)
			VALUES (${FAMILY}, ${childId}, ${'並行検証子'})
		`);
	}

	it('[V1] OCC 実発生: retry なしで同一 child へ 8 並行 → SQLSTATE 40001 を実測', async () => {
		const childId = crypto.randomUUID();
		const activityId = crypto.randomUUID();
		await seedChild(childId);

		// retry を挟まない素の runner (40001 を生で観測する)
		const rawRunner: TransactionRunner<Tx> = {
			runInTransaction: (work) => db.transaction((tx) => work(tx)),
		};
		const results = await Promise.allSettled(
			Array.from({ length: PARALLEL }, () =>
				recordActivityCore(rawRunner, coreInput(childId, activityId, 0)),
			),
		);
		const occErrors = results.filter(
			(r) => r.status === 'rejected' && isOccConflict(r.reason),
		).length;
		const otherErrors = results.filter(
			(r) => r.status === 'rejected' && !isOccConflict((r as PromiseRejectedResult).reason),
		);
		console.log(
			`[V1] fulfilled=${results.length - occErrors - otherErrors.length} occ40001=${occErrors} other=${otherErrors.length}`,
		);
		expect(
			otherErrors,
			JSON.stringify(otherErrors.map((r) => String((r as PromiseRejectedResult).reason))),
		).toEqual([]);
		// 共有行 write-write の同時 commit で 40001 が実際に出る (spike#8 実測の staging 再確認)。
		expect(occErrors).toBeGreaterThan(0);
	}, 120_000);

	it('[V2] 冪等 guard: retry 込み 8 並行 (dailyLimit=1) → exactly-once (二重付与なし)', async () => {
		const childId = crypto.randomUUID();
		const activityId = crypto.randomUUID();
		await seedChild(childId);

		// 8 並行の敗者は最悪 7 回 40001 を踏み得るため attempts を引き上げる (本番既定 3 は
		// 家庭スケール 2-3 並行前提、§8。ここでは mechanism の検証が目的)
		const runner = createDsqlTransactionRunner<Tx>(db, { maxAttempts: 12, baseDelayMs: 20 });
		const results = await Promise.all(
			Array.from({ length: PARALLEL }, () =>
				recordActivityCore(runner, coreInput(childId, activityId, null)),
			),
		);
		const okCount = results.filter((r) => r.ok).length;
		const alreadyCount = results.filter((r) => !r.ok && r.reason === 'ALREADY_RECORDED').length;
		console.log(`[V2] ok=${okCount} already=${alreadyCount}`);
		expect(okCount).toBe(1);
		expect(alreadyCount).toBe(PARALLEL - 1);

		const ledger = await db.execute(
			sql`SELECT count(*) AS c, coalesce(sum(amount),0) AS s FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		expect(Number((ledger.rows[0] as { c: unknown }).c)).toBe(1);
		const child = await db.execute(
			sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		// fitness#14 整合: total_point == SUM(ledger) == 10 (1 回分のみ)
		expect(Number((child.rows[0] as { total_point: unknown }).total_point)).toBe(10);
		expect(Number((ledger.rows[0] as { s: unknown }).s)).toBe(10);
	}, 180_000);

	it('[V3] lost update なし: retry 込み 8 並行 (dailyLimit=0 無制限) → 全 commit + 完全整合', async () => {
		const childId = crypto.randomUUID();
		const activityId = crypto.randomUUID();
		await seedChild(childId);

		const runner = createDsqlTransactionRunner<Tx>(db, { maxAttempts: 12, baseDelayMs: 20 });
		const results = await Promise.all(
			Array.from({ length: PARALLEL }, () =>
				recordActivityCore(runner, coreInput(childId, activityId, 0)),
			),
		);
		expect(results.filter((r) => r.ok).length).toBe(PARALLEL);

		// mastery re-read→upsert の lost update が OCC で防がれる = total_count が正確に N
		const mastery = await db.execute(
			sql`SELECT total_count FROM activity_mastery WHERE family_id = ${FAMILY} AND child_id = ${childId} AND activity_id = ${activityId}`,
		);
		expect(Number((mastery.rows[0] as { total_count: unknown }).total_count)).toBe(PARALLEL);

		const ledger = await db.execute(
			sql`SELECT count(*) AS c, coalesce(sum(amount),0) AS s FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		expect(Number((ledger.rows[0] as { c: unknown }).c)).toBe(PARALLEL);
		const child = await db.execute(
			sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		// fitness#14 整合: total_point == SUM(ledger) == N×10
		expect(Number((child.rows[0] as { total_point: unknown }).total_point)).toBe(PARALLEL * 10);
		expect(Number((ledger.rows[0] as { s: unknown }).s)).toBe(PARALLEL * 10);

		// statuses の XP 累積も lost update なし
		const status = await db.execute(
			sql`SELECT total_xp FROM statuses WHERE family_id = ${FAMILY} AND child_id = ${childId} AND category_id = 'undou'`,
		);
		expect(Number((status.rows[0] as { total_xp: unknown }).total_xp)).toBe(PARALLEL * 10);
	}, 180_000);

	it('[V4] cancel 原子化 (#3596 ②): 同一 log を 8 並行 cancel → exactly-once 返金 (二重返金なし)', async () => {
		const childId = crypto.randomUUID();
		const activityId = crypto.randomUUID();
		await seedChild(childId);

		// 1) 1 件記録 (base 10、cancel 対象の log を作る)
		const runner = createDsqlTransactionRunner<Tx>(db, { maxAttempts: 12, baseDelayMs: 20 });
		const rec = await recordActivityCore(runner, coreInput(childId, activityId, 0));
		expect(rec.ok).toBe(true);
		if (!rec.ok) return;
		const logId = rec.logId;

		// 2) 同一 log を 8 並行 cancel。冪等 guard (cancel UPDATE affected 行判定) が
		//    OCC 40001 retry と協調し exactly-once 返金になることを実 DSQL で確認する。
		const cancelInput = {
			familyId: FAMILY,
			childId,
			activityId,
			logId,
			categoryId: 'undou',
			refundPoints: 10,
			recordedDate: TODAY,
			now: NOW,
			description: 'キャンセル',
			changeType: 'activity_cancel',
			masteryLevelFor: (c: number) => Math.floor(c / 10) + 1,
			revertStatusXp: (cur: number) => Math.max(0, cur - 10),
			statusLevelFor: (xp: number) => Math.floor(xp / 100) + 1,
		};
		const results = await Promise.all(
			Array.from({ length: PARALLEL }, () => cancelActivityCore(runner, cancelInput)),
		);
		const okCount = results.filter((r) => r.ok).length;
		const alreadyCount = results.filter((r) => !r.ok && r.reason === 'ALREADY_CANCELLED').length;
		console.log(`[V4] ok=${okCount} alreadyCancelled=${alreadyCount}`);
		// 勝者 1 件のみが返金し、残りは ALREADY_CANCELLED (二重返金を serialization anchor が防ぐ)
		expect(okCount).toBe(1);
		expect(alreadyCount).toBe(PARALLEL - 1);

		// cancel ledger(−10) は 1 行だけ。原 +10 と相殺し total_point == SUM(ledger) == 0。
		const cancelLedger = await db.execute(
			sql`SELECT count(*) AS c FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId} AND type = 'cancel'`,
		);
		expect(Number((cancelLedger.rows[0] as { c: unknown }).c)).toBe(1);
		const child = await db.execute(
			sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		const ledgerSum = await db.execute(
			sql`SELECT coalesce(sum(amount),0) AS s FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		expect(Number((child.rows[0] as { total_point: unknown }).total_point)).toBe(0);
		expect(Number((ledgerSum.rows[0] as { s: unknown }).s)).toBe(0);
	}, 180_000);
});
