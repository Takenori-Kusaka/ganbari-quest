// tests/unit/services/activity-record-dsql-pglite.test.ts
// EPIC #3424 / 実装 #3541 Phase Z / 設計 SSOT: dsql-data-model.md §8
//
// recordActivity の dsql 経路を **実 schema (PGlite + pushSchema) + 実 recordActivityCore** で
// end-to-end 検証する。mock は接続層 (getDsqlDb / getDsqlTransactionRunner) のみ差し替え、
// service dispatch → prepareActivityRecord (dsql repo 読取) → core 単一 txn → optional 隔離
// までを本物の code path で通す:
//   [E1] 記録成功: ledger / total_point / statuses / status_history / activity_logs 反映
//        (§5 P7: total_point == SUM(point_ledger) の共更新)
//   [E2] 二重記録: ALREADY_RECORDED + 全表不変 (冪等)
//
// ⚠️ PGlite は単一接続 (dsql-test-db.ts 注記)。本テストは逐次 await のみで deadlock 形なし。

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { asCategoryId, asChildId, type ChildId } from '../../../src/lib/domain/ids';
import { assertSuccess } from '../helpers/assert-result';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

// vi.mock より先に実行される hoisted block で backend を dsql に固定する
// ($lib/runtime/env は module load 時に getEnv() を評価するため、import 前に設定が必要)
const holder = vi.hoisted(() => {
	process.env.DATA_SOURCE = 'dsql';
	return {
		db: null as unknown,
		runner: null as unknown,
	};
});

// 接続層のみ差し替え: 実 DSQL pool の代わりに PGlite (実 schema 適用済) を返す。
// factory.ts の dsql 分岐 / recordActivityDsql はこの mock 経由で PGlite に接続する。
vi.mock('$lib/server/db/dsql/connection', () => ({
	getDsqlDb: () => holder.db,
	getDsqlTransactionRunner: () => holder.runner,
}));

import { createDsqlChildActivityRepo } from '../../../src/lib/server/db/dsql/child-activity-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
// サービス層 (dispatch 元) は mock 設定後に import
import {
	cancelActivityLog,
	recordActivity,
} from '../../../src/lib/server/services/activity-log-service';

const FAMILY = '00000000-0000-4000-8000-0000000000e1';

let t: DsqlTestDb;
let childId: ChildId;
let activityId: string;
let activityId2: string;

const count = async (table: string, cid: string) =>
	Number(
		(
			(await t.db.execute(
				sql.raw(
					`SELECT count(*) AS c FROM ${table} WHERE family_id = '${FAMILY}' AND child_id = '${cid}'`,
				),
			)) as { rows: { c: unknown }[] }
		).rows[0]?.c,
	);

const totalPoint = async (cid: string) =>
	(
		(
			await t.db.execute(
				sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${cid}`,
			)
		).rows[0] as { total_point: number }
	).total_point;

beforeAll(async () => {
	t = await createDsqlTestDb();
	holder.db = t.db;
	holder.runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });

	// seed: child 1 人 + activity 2 件 (focus bonus が「全おすすめ達成」にならない構成)
	const res = await t.db.execute(sql`
		INSERT INTO children (family_id, nickname, birth_date, theme, ui_mode)
		VALUES (${FAMILY}, 'ぴぐちゃん', '2018-01-15', 'blue', 'preschool')
		RETURNING child_id
	`);
	childId = asChildId((res.rows[0] as { child_id: string }).child_id);

	const repo = createDsqlChildActivityRepo(t.db as never, holder.runner as never);
	const a1 = await repo.insertActivity(
		{ childId, name: 'たいそう', categoryId: asCategoryId('1'), icon: '🤸', basePoints: 5 },
		FAMILY,
	);
	const a2 = await repo.insertActivity(
		{ childId, name: 'えほん', categoryId: asCategoryId('2'), icon: '📖', basePoints: 5 },
		FAMILY,
	);
	activityId = a1.id;
	activityId2 = a2.id;
}, 60_000);

afterAll(async () => {
	await t.close();
});

describe('#3541 Phase Z: dsql 経路 end-to-end (PGlite 実 schema + 実 core)', () => {
	it('[E1] 記録成功: core 5 表反映 + total_point == SUM(point_ledger) (§5 P7)', async () => {
		const result = assertSuccess(await recordActivity(childId, activityId as never, FAMILY));

		// RecordActivityResult 契約 (frontend 契約不変)
		expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(result.basePoints).toBe(5);
		expect(result.streakDays).toBe(1);
		expect(result.streakBonus).toBe(0);
		expect(result.masteryBonus).toBe(0);
		expect(result.totalPoints).toBe(5);
		expect(result.masteryLevel).toBe(1);
		expect(result.activityName).toBe('たいそう');
		expect(result.xpGain).toMatchObject({ xpBefore: 0, xpAfter: 5 });

		// core 5 表 all-or-nothing 反映
		expect(await count('activity_logs', childId)).toBe(1);
		expect(await count('activity_mastery', childId)).toBe(1);
		expect(await count('statuses', childId)).toBe(1);
		expect(await count('status_history', childId)).toBe(1);

		// §5 P7: ledger INSERT + total_point 共更新 (activity type 1 行 = 5pt)
		const ledger = (
			await t.db.execute(
				sql`SELECT amount, type, description FROM point_ledger
					WHERE family_id = ${FAMILY} AND child_id = ${childId} AND type = 'activity'`,
			)
		).rows as { amount: number; type: string; description: string }[];
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.amount).toBe(5);
		expect(ledger[0]?.description).toBe('たいそう');
		expect(await totalPoint(childId)).toBe(5);

		// statuses xp 反映 (XP = ポイント統合)
		const status = (
			await t.db.execute(
				sql`SELECT total_xp, category_id FROM statuses
					WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
			)
		).rows[0] as { total_xp: number; category_id: string };
		expect(status.total_xp).toBe(5);
		expect(status.category_id).toBe('1');
	});

	it('[E2] 二重記録: ALREADY_RECORDED で全表不変 (冪等)', async () => {
		const second = await recordActivity(childId, activityId as never, FAMILY);
		expect(second).toEqual({ error: 'ALREADY_RECORDED' });

		expect(await count('activity_logs', childId)).toBe(1);
		expect(await count('status_history', childId)).toBe(1);
		expect(await totalPoint(childId)).toBe(5);
	});

	it('[E3] #3787: mastery_bonus 付与済 record→cancel は対称返金し total_point net 0', async () => {
		// activityId2 に習熟 Lv5 (total_count=30) を seed → 次の record で masteryBonus = floor(5/5) = 1
		await t.db.execute(sql`
			INSERT INTO activity_mastery (family_id, child_id, activity_id, total_count, level)
			VALUES (${FAMILY}, ${childId}, ${activityId2}, 30, 5)
		`);

		const recorded = assertSuccess(await recordActivity(childId, activityId2 as never, FAMILY));
		// この record で mastery_bonus が実際に付与されている (前提)。totalPoints は base+streak+mastery。
		expect(recorded.masteryBonus).toBeGreaterThan(0);
		// achievement 解禁分の別 ledger が混ざるため total_point の絶対値ではなく cancel の相殺量で検証する。
		const afterRecord = await totalPoint(childId);

		const cancelResult = await cancelActivityLog(recorded.id, FAMILY);
		if ('error' in cancelResult) throw new Error(`Unexpected error: ${cancelResult.error}`);
		// 対称返金: cancel は base+streak だけでなく mastery_bonus 込みの totalPoints 全額を返金する
		// (pre-fix は base+streak のみで mastery_bonus 分が balance に残った)。
		expect(cancelResult.refundedPoints).toBe(recorded.totalPoints);
		// cancel は activity ledger 相殺のみ (achievement 分は据置)。total_point は正確に totalPoints 減る。
		expect(await totalPoint(childId)).toBe(afterRecord - recorded.totalPoints);
	});
});
