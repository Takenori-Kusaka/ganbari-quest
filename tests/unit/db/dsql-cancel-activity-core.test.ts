// tests/unit/db/dsql-cancel-activity-core.test.ts
// EPIC #3424 / #3596 ② (cancel atomicity) / 設計 SSOT: dsql-data-model.md §8 / §5(P7)
//
// cancelActivity core の単一 txn 原子化 (record-activity-core.ts と対称):
//   ① activity_logs cancel (冪等 guard + serialization anchor) ② activity_mastery count−1
//   ③ point_ledger INSERT(−) + children.total_point 減算 ④ statuses 復元 ⑤ status_history。
//   現行 cancelActivityLog の「txn 無し・逐次 4 await」による部分コミット (log は cancel 化したが
//   point 未返金 等) を all-or-nothing で根絶する。
//
// ── Canon TDD test list ──
//   [C1] cancel 成功: log=cancelled / mastery count−1 / ledger(−) / total_point 減 / status 復元 / history
//   [C2] 二重 cancel (同一 log 2 回目): ALREADY_CANCELLED + 副作用は 1 回のみ (二重返金なし)
//   [C3] 途中失敗 (child 不在 → total_point 更新不能): 全 rollback (log の cancelled も戻る)
//   [C4] categoryId=null (activity 削除済): status/history 復元 skip、log/mastery/ledger は実行
//   [C5] mastery 未存在 (count=0): mastery 書込 skip、他は実行
//   [C6] status 復元は revertStatusXp 注入値を verbatim 使用 (単純減算を core に hardcode しない)
//   [C7] fitness#14 整合: cancel 後 total_point == SUM(ledger)

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FAMILY = '00000000-0000-4000-8000-0000000000c1';
const NOW = '2026-07-16T10:00:00+00:00';
const TODAY = '2026-07-16';

describe('#3596 ②: cancelActivityCore 単一 txn (§8 cancel all-or-nothing)', () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle>;
	let seq = 0;

	beforeAll(async () => {
		client = new PGlite();
		db = drizzle(client);
		// core txn が触る 6 表の最小 fixture (完全 DDL は dsql/schema.ts が SSOT)。
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

	/**
	 * 記録済 (cancel 対象) を seed する: children.total_point / activity_logs / activity_mastery /
	 * statuses / 原 point_ledger(+) を整合させて用意し、cancel 対象の logId を返す。
	 */
	const seedRecorded = async (opts?: {
		points?: number;
		streakBonus?: number;
		masteryCount?: number;
		xp?: number;
		peak?: number;
		category?: string;
	}) => {
		seq++;
		const childId = `c0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
		const activityId = `a0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
		const points = opts?.points ?? 10;
		const streakBonus = opts?.streakBonus ?? 2;
		const refund = points + streakBonus;
		const masteryCount = opts?.masteryCount ?? 1;
		const xp = opts?.xp ?? refund;
		const peak = opts?.peak ?? xp;
		const category = opts?.category ?? 'undou';
		await db.execute(
			sql`INSERT INTO children (family_id, child_id, total_point) VALUES (${FAMILY}, ${childId}, ${refund})`,
		);
		const inserted = await db.execute(sql`
			INSERT INTO activity_logs (family_id, child_id, activity_id, points, streak_bonus, recorded_date, recorded_at)
			VALUES (${FAMILY}, ${childId}, ${activityId}, ${points}, ${streakBonus}, ${TODAY}, ${NOW})
			RETURNING log_id`);
		const logId = (inserted.rows[0] as { log_id: string }).log_id;
		if (masteryCount > 0) {
			await db.execute(sql`
				INSERT INTO activity_mastery (family_id, child_id, activity_id, total_count, level, updated_at)
				VALUES (${FAMILY}, ${childId}, ${activityId}, ${masteryCount}, 1, ${NOW})`);
		}
		await db.execute(sql`
			INSERT INTO statuses (family_id, child_id, category_id, total_xp, level, peak_xp, updated_at)
			VALUES (${FAMILY}, ${childId}, ${category}, ${xp}, 1, ${peak}, ${NOW})`);
		await db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date, created_at)
			VALUES (${FAMILY}, ${childId}, ${refund}, 'activity', '記録', ${logId}, ${TODAY}, ${NOW})`);
		return { childId, activityId, logId, refund, category };
	};

	const makeCore = async (over: Record<string, unknown>) => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		const { cancelActivityCore } = await import(
			'../../../src/lib/server/db/dsql/cancel-activity-core'
		);
		const runner = createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
		return cancelActivityCore(runner, {
			familyId: FAMILY,
			recordedDate: TODAY,
			now: NOW,
			description: 'キャンセル',
			changeType: 'activity_cancel',
			masteryLevelFor: (count: number) => Math.floor(count / 5) + 1,
			// 既定は単純減算 (0 clamp)。clampDecayFloor 契約検証は [C6] で個別注入。
			revertStatusXp: (cur: number, _peak: number) =>
				Math.max(0, cur - (over.refundPoints as number)),
			statusLevelFor: (xp: number) => Math.floor(xp / 100) + 1,
			...over,
		} as never);
	};

	const totalPoint = async (childId: string) =>
		Number(
			(
				(
					await db.execute(
						sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
					)
				).rows[0] as { total_point: number }
			).total_point,
		);
	const ledgerSum = async (childId: string) =>
		Number(
			(
				(
					await db.execute(
						sql`SELECT COALESCE(SUM(amount),0)::int AS s FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
					)
				).rows[0] as { s: number }
			).s,
		);
	const ledgerCount = async (childId: string) =>
		Number(
			(
				(
					await db.execute(
						sql`SELECT count(*) AS c FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
					)
				).rows[0] as { c: unknown }
			).c,
		);
	const isCancelled = async (logId: string) =>
		(
			(
				await db.execute(
					sql`SELECT cancelled FROM activity_logs WHERE family_id = ${FAMILY} AND log_id = ${logId}`,
				)
			).rows[0] as { cancelled: boolean }
		).cancelled;
	const masteryCount = async (childId: string) => {
		const r = (
			await db.execute(
				sql`SELECT total_count FROM activity_mastery WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
			)
		).rows[0] as { total_count: number } | undefined;
		return r ? Number(r.total_count) : null;
	};
	const status = async (childId: string, category: string) =>
		(
			await db.execute(
				sql`SELECT total_xp FROM statuses WHERE family_id = ${FAMILY} AND child_id = ${childId} AND category_id = ${category}`,
			)
		).rows[0] as { total_xp: number } | undefined;
	const historyCount = async (childId: string) =>
		Number(
			(
				(
					await db.execute(
						sql`SELECT count(*) AS c FROM status_history WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
					)
				).rows[0] as { c: unknown }
			).c,
		);

	it('[C1] cancel 成功: log=cancelled / mastery count−1 / ledger(−) / total_point 減 / status 復元 / history', async () => {
		const { childId, activityId, logId, refund, category } = await seedRecorded();
		const result = await makeCore({
			childId,
			activityId,
			logId,
			categoryId: category,
			refundPoints: refund,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.refundedPoints).toBe(refund);
		expect(await isCancelled(logId)).toBe(true);
		expect(await totalPoint(childId)).toBe(0);
		expect(await ledgerSum(childId)).toBe(0); // +refund と −refund で相殺
		expect(await ledgerCount(childId)).toBe(2);
		expect(await masteryCount(childId)).toBe(0);
		expect((await status(childId, category))?.total_xp).toBe(0); // 単純減算 refund→0
		expect(await historyCount(childId)).toBe(1);
	});

	it('[C2] 二重 cancel: 2 回目は ALREADY_CANCELLED + 副作用は 1 回のみ (二重返金なし)', async () => {
		const { childId, activityId, logId, refund, category } = await seedRecorded();
		const first = await makeCore({
			childId,
			activityId,
			logId,
			categoryId: category,
			refundPoints: refund,
		});
		expect(first.ok).toBe(true);
		const tpAfterFirst = await totalPoint(childId);
		const second = await makeCore({
			childId,
			activityId,
			logId,
			categoryId: category,
			refundPoints: refund,
		});
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.reason).toBe('ALREADY_CANCELLED');
		// 2 回目は何も書かない: total_point / ledger 件数不変
		expect(await totalPoint(childId)).toBe(tpAfterFirst);
		expect(await ledgerCount(childId)).toBe(2); // 原+1 と cancel−1 のみ (2 回目の −1 は入らない)
	});

	it('[C3] 途中失敗 (child 不在 → total_point 更新不能): 全 rollback (cancelled も戻る)', async () => {
		const { childId, activityId, logId, refund, category } = await seedRecorded();
		// cancel UPDATE は通るが total_point 共更新先の children 行を消しておく → ③ で 0 行 → throw → rollback。
		await db.execute(
			sql`DELETE FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		await expect(
			makeCore({ childId, activityId, logId, categoryId: category, refundPoints: refund }),
		).rejects.toThrow(/child not found/);
		// log の cancelled は元の false のまま (部分コミット禁止 = ① cancel UPDATE も巻戻る)
		expect(await isCancelled(logId)).toBe(false);
		// ledger の cancel(−) 行も入っていない
		expect(await ledgerCount(childId)).toBe(1); // 原 +refund のみ
	});

	it('[C4] categoryId=null (activity 削除済): status/history 復元 skip、log/mastery/ledger は実行', async () => {
		const { childId, activityId, logId, refund, category } = await seedRecorded();
		const before = await status(childId, category);
		const result = await makeCore({
			childId,
			activityId,
			logId,
			categoryId: null,
			refundPoints: refund,
		});
		expect(result.ok).toBe(true);
		expect(await isCancelled(logId)).toBe(true);
		expect(await totalPoint(childId)).toBe(0);
		expect(await masteryCount(childId)).toBe(0);
		// status は触られない (削除済カテゴリ復元は skip)
		expect((await status(childId, category))?.total_xp).toBe(before?.total_xp);
		expect(await historyCount(childId)).toBe(0);
	});

	it('[C5] mastery 未存在 (count=0): mastery 書込 skip、他は実行', async () => {
		const { childId, activityId, logId, refund, category } = await seedRecorded({
			masteryCount: 0,
		});
		const result = await makeCore({
			childId,
			activityId,
			logId,
			categoryId: category,
			refundPoints: refund,
		});
		expect(result.ok).toBe(true);
		expect(await masteryCount(childId)).toBe(null); // 行なしのまま
		expect(await totalPoint(childId)).toBe(0);
	});

	it('[C6] status 復元は revertStatusXp 注入値を verbatim 使用 (clampDecayFloor 契約を core が hardcode しない)', async () => {
		const { childId, activityId, logId, refund, category } = await seedRecorded({
			xp: 100,
			peak: 100,
		});
		// 減衰 floor 契約: 復元後 = max(0, clampDecayFloor(cur, refund, peak)) を注入し core が verbatim 使用することを確認。
		// clampDecayFloor(100, 12, 100) = max(100-12, round(100*0.7)) = max(88, 70) = 88
		const result = await makeCore({
			childId,
			activityId,
			logId,
			categoryId: category,
			refundPoints: refund,
			revertStatusXp: (cur: number, peak: number) =>
				Math.max(0, Math.max(cur - refund, Math.round(peak * 0.7))),
		});
		expect(result.ok).toBe(true);
		expect((await status(childId, category))?.total_xp).toBe(88);
	});

	it('[C7] fitness#14 整合: cancel 後 total_point == SUM(ledger)', async () => {
		const { childId, activityId, logId, refund, category } = await seedRecorded({
			points: 30,
			streakBonus: 5,
		});
		await makeCore({ childId, activityId, logId, categoryId: category, refundPoints: refund });
		expect(await totalPoint(childId)).toBe(await ledgerSum(childId));
	});
});
