// tests/unit/db/dsql-record-activity-core.test.ts
// EPIC #3424 / 実装 #3541 (#N4-2 Phase C cycle 1) / 設計 SSOT: dsql-data-model.md §8 / §5(P7)
//
// recordActivity core 5 行の単一 txn 原子化 (§8「最大の質的改善」):
//   ① activity_logs INSERT ② activity_mastery UPSERT ③ point_ledger INSERT +
//   children.total_point 共更新 ④ statuses UPSERT ⑤ status_history INSERT を all-or-nothing。
//   現行 (activity-log-service.ts) の「txn 無し・逐次 await・例外握り潰し」による部分コミット
//   (point 入ったが status 未更新等) を構造的に根絶する。
//   冪等性の正は「txn 内 re-read」(§8): dailyLimit 判定を txn 内で再実行し、HTTP 再送 /
//   二連打による二重付与を serialization point (DSQL 40001 / SQLite IMMEDIATE) で防ぐ。
//
// ── Canon TDD test list (cycle 1 = core txn。optional 隔離 / fitness#10,#11 は cycle 2) ──
//   [R1] 初回記録: 5 表全てに行 + total_point 加算
//   [R2] dailyLimit null(=1回): 2 回目は ALREADY_RECORDED で全表不変 (txn 内 re-read)
//   [R2b] dailyLimit N / 0(無制限) の分岐
//   [R3] 途中失敗 (最終 write の NOT NULL violation) → 5 表全 rollback (部分コミット禁止)
//   [R4] 累積: mastery count/level 更新 + statuses xp 加算 + peak 維持
//   [R5] fitness#14 整合: 記録後 findTotalPointDrift が 0 件 (total_point == SUM)

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FAMILY = '00000000-0000-4000-8000-0000000000f1';
const NOW = '2026-07-02T10:00:00+00:00';
const TODAY = '2026-07-02';

describe('#N4-2 cycle1: recordActivityCore 単一 txn (§8 core 5 行 all-or-nothing)', () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle>;
	let childSeq = 0;

	beforeAll(async () => {
		client = new PGlite();
		db = drizzle(client);
		// core txn が触る 6 表の最小 fixture (完全 DDL は dsql/schema.ts が SSOT、fitness#9/#13 検証済)。
		const ddl = [
			`CREATE TABLE children (
				family_id uuid NOT NULL, child_id uuid NOT NULL,
				total_point integer NOT NULL DEFAULT 0,
				updated_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (family_id, child_id))`,
			`CREATE TABLE activity_logs (
				family_id uuid NOT NULL, child_id uuid NOT NULL,
				log_id uuid NOT NULL DEFAULT gen_random_uuid(),
				activity_id uuid NOT NULL, points integer NOT NULL,
				streak_days integer NOT NULL DEFAULT 1, streak_bonus integer NOT NULL DEFAULT 0,
				recorded_date text NOT NULL, recorded_at timestamptz NOT NULL,
				cancelled boolean NOT NULL DEFAULT false,
				PRIMARY KEY (family_id, child_id, log_id))`,
			`CREATE TABLE activity_mastery (
				family_id uuid NOT NULL, child_id uuid NOT NULL, activity_id uuid NOT NULL,
				total_count integer NOT NULL DEFAULT 0, level integer NOT NULL DEFAULT 1,
				updated_at timestamptz NOT NULL,
				PRIMARY KEY (family_id, child_id, activity_id))`,
			`CREATE TABLE point_ledger (
				family_id uuid NOT NULL, child_id uuid NOT NULL,
				ledger_id uuid NOT NULL DEFAULT gen_random_uuid(),
				amount integer NOT NULL, type text NOT NULL, description text,
				reference_id text, recorded_date text NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (family_id, child_id, ledger_id))`,
			`CREATE TABLE statuses (
				family_id uuid NOT NULL, child_id uuid NOT NULL, category_id text NOT NULL,
				total_xp integer NOT NULL DEFAULT 0, level integer NOT NULL DEFAULT 1,
				peak_xp integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL,
				PRIMARY KEY (family_id, child_id, category_id))`,
			`CREATE TABLE status_history (
				family_id uuid NOT NULL, child_id uuid NOT NULL, category_id text NOT NULL,
				hist_id uuid NOT NULL DEFAULT gen_random_uuid(),
				value real NOT NULL, change_amount real NOT NULL, change_type text NOT NULL,
				recorded_at timestamptz NOT NULL,
				PRIMARY KEY (family_id, child_id, category_id, hist_id))`,
		];
		for (const stmt of ddl) await db.execute(sql.raw(stmt));
	});
	afterAll(async () => {
		await client.close();
	});

	/** child + activity id を払い出し children 行を seed する (テスト間独立)。 */
	const newChild = async () => {
		childSeq++;
		const childId = `c0000000-0000-4000-8000-${String(childSeq).padStart(12, '0')}`;
		const activityId = `a0000000-0000-4000-8000-${String(childSeq).padStart(12, '0')}`;
		await db.execute(
			sql`INSERT INTO children (family_id, child_id) VALUES (${FAMILY}, ${childId})`,
		);
		return { childId, activityId };
	};

	const makeCore = async () => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		const { recordActivityCore } = await import(
			'../../../src/lib/server/db/dsql/record-activity-core'
		);
		const runner = createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
		return (over: Record<string, unknown>) =>
			recordActivityCore(runner, {
				familyId: FAMILY,
				categoryId: 'undou',
				basePoints: 10,
				streakBonus: 2,
				masteryBonus: 0,
				streakDays: 3,
				recordedDate: TODAY,
				now: NOW,
				dailyLimit: null,
				description: 'テスト活動',
				changeType: 'activity_record',
				masteryLevelFor: (count: number) => Math.floor(count / 5) + 1,
				statusLevelFor: (xp: number) => Math.floor(xp / 100) + 1,
				...over,
			} as never);
	};

	const count = async (table: string, childId: string) =>
		Number(
			(
				(await db.execute(
					sql.raw(
						`SELECT count(*) AS c FROM ${table} WHERE family_id = '${FAMILY}' AND child_id = '${childId}'`,
					),
				)) as { rows: { c: unknown }[] }
			).rows[0]?.c,
		);

	const totalPoint = async (childId: string) =>
		(
			(
				await db.execute(
					sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
				)
			).rows[0] as { total_point: number }
		).total_point;

	it('[R1] 初回記録: 5 表全てに行が入り total_point が加算される (all-or-nothing commit)', async () => {
		const { childId, activityId } = await newChild();
		const core = await makeCore();
		const result = await core({ childId, activityId });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// total = base 10 + streak 2 + mastery 0
		expect(result.totalPoints).toBe(12);
		expect(await count('activity_logs', childId)).toBe(1);
		expect(await count('activity_mastery', childId)).toBe(1);
		expect(await count('point_ledger', childId)).toBe(1);
		expect(await count('statuses', childId)).toBe(1);
		expect(await count('status_history', childId)).toBe(1);
		expect(await totalPoint(childId)).toBe(12);
	});

	it('[R2] dailyLimit null(=1回): 2 回目は ALREADY_RECORDED (txn 内 re-read、全表不変)', async () => {
		const { childId, activityId } = await newChild();
		const core = await makeCore();
		await core({ childId, activityId });
		const second = await core({ childId, activityId });
		expect(second).toEqual({ ok: false, reason: 'ALREADY_RECORDED' });
		expect(await count('activity_logs', childId)).toBe(1);
		expect(await count('point_ledger', childId)).toBe(1);
		expect(await totalPoint(childId)).toBe(12);
	});

	it('[R2b] dailyLimit 2 → 3 回目は DAILY_LIMIT_REACHED / dailyLimit 0 は無制限', async () => {
		const limited = await newChild();
		const core = await makeCore();
		await core({ ...limited, dailyLimit: 2 });
		await core({ ...limited, dailyLimit: 2 });
		const third = await core({ ...limited, dailyLimit: 2 });
		expect(third).toEqual({ ok: false, reason: 'DAILY_LIMIT_REACHED' });

		const unlimited = await newChild();
		for (let i = 0; i < 4; i++) {
			const r = await core({ ...unlimited, dailyLimit: 0 });
			expect(r.ok).toBe(true);
		}
		expect(await count('activity_logs', unlimited.childId)).toBe(4);
	});

	it('[R3] 途中失敗 (最終 write の NOT NULL violation) → 5 表全 rollback (部分コミット禁止)', async () => {
		const { childId, activityId } = await newChild();
		const core = await makeCore();
		// changeType null → 最終 write (status_history INSERT) が NOT NULL violation で fail。
		// 現行実装なら log/ledger/mastery が partial commit する場面 — 単一 txn では全て巻き戻る。
		await expect(core({ childId, activityId, changeType: null })).rejects.toThrow();
		expect(await count('activity_logs', childId)).toBe(0);
		expect(await count('activity_mastery', childId)).toBe(0);
		expect(await count('point_ledger', childId)).toBe(0);
		expect(await count('statuses', childId)).toBe(0);
		expect(await totalPoint(childId)).toBe(0);
	});

	it('[R4] 累積: mastery count/level と statuses xp/peak が txn 内 re-read で更新される', async () => {
		const { childId, activityId } = await newChild();
		const core = await makeCore();
		// masteryLevelFor = floor(count/5)+1 → 5 回目で level 2
		for (let i = 0; i < 5; i++) {
			const r = await core({ childId, activityId, dailyLimit: 0 });
			expect(r.ok).toBe(true);
		}
		const mastery = (
			await db.execute(
				sql`SELECT total_count, level FROM activity_mastery WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
			)
		).rows[0] as { total_count: number; level: number };
		expect(mastery).toEqual({ total_count: 5, level: 2 });

		const status = (
			await db.execute(
				sql`SELECT total_xp, peak_xp FROM statuses WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
			)
		).rows[0] as { total_xp: number; peak_xp: number };
		expect(status.total_xp).toBe(60); // 12 × 5
		expect(status.peak_xp).toBe(60);
		expect(await count('status_history', childId)).toBe(5);
	});

	it('[R5] fitness#14 整合: 記録後の total_point == SUM(point_ledger) (drift 0 件)', async () => {
		const { findTotalPointDrift } = await import('../../../src/lib/server/db/dsql/derived-drift');
		const drifts = await findTotalPointDrift(db);
		expect(drifts, 'core txn の共更新により drift は構造的に 0').toEqual([]);
	});
});
