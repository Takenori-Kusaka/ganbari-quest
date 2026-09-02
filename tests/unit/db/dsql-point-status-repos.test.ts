// tests/unit/db/dsql-point-status-repos.test.ts
// EPIC #3424 / PR-R4 / 設計 SSOT: dsql-data-model.md §5(P7) / §11.2 / §P9
//
// DSQL IPointRepo + IStatusRepo 実装のテスト。実 schema (pushSchema 適用、dsql-test-db helper):
//
// ── IPointRepo ──
//   [P1] insertPointEntry → entry round-trip + children.total_point 同一 txn 共更新 (== SUM)
//   [P2] 負値エントリ (取消) も total_point 同期 (== SUM)
//   [P3] child 不在への insert は throw + ledger 未挿入 (片肺書込の rollback、§5 P7)
//   [P4] getBalance = children.total_point 単読 (SUM 再計算しない = compute-on-write §5)
//   [P5] findPointHistory: created_at 降順 + limit/offset + 返り値 shape parity
//   [P6] spendPointsAtomic 成功: 負値エントリ + total_point 減算 (== SUM)
//   [P7] spendPointsAtomic 残高不足: INSUFFICIENT_POINTS + 無書込
//   [P8] §P9 tenant 分離: 他 family から balance/history 不可視、spend も不能
//   [P9] deletePointLedgerBeforeDate: cutoff 前だけ削除・total_point 不触 (carryover 廃止、
//        reset-plan 決定#4。#729「ポイントは消えず過去明細だけが消える」を total_point 不触で満たす)
//   [P9b] deletePointLedgerBeforeDate: 対象 0 件は無書込 (carryover 生成 0)
//   [P10] deleteByTenantId: ledger 全削除 + total_point 0 リセット (== SUM 維持)、他 tenant 無傷
//   [P11] spendPointsAtomic 二重引落: FOR UPDATE で残高非負維持 (I-BAL-NONNEG, §6.6 F7)
//
// ── IStatusRepo ──
//   [S1] upsertStatus: insert → update (負 XP は 0 clamp、sqlite parity) + shape
//   [S2] findStatuses / findStatus + §P9 tenant 分離
//   [S3] insertStatusHistory → findRecentStatusHistory (降順 + limit 既定 7)
//   [S4] findStatusValueAtDate: 指定日前の最新値 / 該当なし null
//   [S5] benchmark upsert (insert/update) + findBenchmark + findAllBenchmarks (グローバル master、
//        tenant 非依存 = sqlite parity)
//   [S6] findLastActivityDates: activityId keyed (既存命名の歪み parity 維持) + cancelled 除外
//   [S7] deleteByTenantId: statuses/status_history 削除、market_benchmarks は survive

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asCategoryId, asChildId, type ChildId } from '../../../src/lib/domain/ids';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { findTotalPointDrift } from '../../../src/lib/server/db/dsql/derived-drift';
import { createDsqlPointRepo } from '../../../src/lib/server/db/dsql/point-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import { createDsqlStatusRepo } from '../../../src/lib/server/db/dsql/status-repo';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { IPointRepo } from '../../../src/lib/server/db/interfaces/point-repo.interface';
import type { IStatusRepo } from '../../../src/lib/server/db/interfaces/status-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000b1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000b2';

describe('DSQL point-repo / status-repo (PR-R4、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let pointRepo: IPointRepo;
	let statusRepo: IStatusRepo;

	/** 新規 child を作って id を返す (各テストは自分の child で分離)。 */
	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	/**
	 * 指定 child の書込増分整合 (total_point == SUM) を assert する (fitness#14 再定義)。
	 * carryover 廃止後は pruning 済 child が恒久的に drift を持つため、共有 db 全体でなく
	 * **当該 child (非 pruning scope) のみ**を突合する (reset-plan 決定#4)。
	 */
	const expectNoDrift = async (childId: ChildId) => {
		const drift = await findTotalPointDrift(t.db);
		const forChild = drift.filter((d) => String(d.childId) === String(childId));
		expect(forChild, 'total_point == SUM(point_ledger.amount) (fitness#14)').toEqual([]);
	};

	const totalPointOf = async (childId: ChildId, family = FAMILY): Promise<number> => {
		const r = await t.db.execute(
			sql`SELECT total_point FROM children WHERE family_id = ${family} AND child_id = ${String(childId)}`,
		);
		return Number((r.rows[0] as { total_point: number }).total_point);
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		pointRepo = createDsqlPointRepo(t.db, runner);
		statusRepo = createDsqlStatusRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── IPointRepo ───────────────────

	it('[P1] insertPointEntry: entry round-trip + total_point 同一 txn 共更新 (== SUM)', async () => {
		const childId = await newChild('ポイント太郎');
		const entry = await pointRepo.insertPointEntry(
			{ childId, amount: 10, type: 'activity', description: 'てすと', referenceId: 'ref-1' },
			FAMILY,
		);
		expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(entry.childId).toBe(childId);
		expect(entry.amount).toBe(10);
		expect(entry.type).toBe('activity');
		expect(entry.description).toBe('てすと');
		expect(entry.referenceId).toBe('ref-1');
		expect(typeof entry.createdAt).toBe('string');

		expect(await totalPointOf(childId)).toBe(10);
		await expectNoDrift(childId);

		// referenceId 未指定は null (sqlite parity)
		const noRef = await pointRepo.insertPointEntry(
			{ childId, amount: 5, type: 'bonus', description: 'ぼーなす' },
			FAMILY,
		);
		expect(noRef.referenceId).toBe(null);
		expect(await totalPointOf(childId)).toBe(15);
	});

	it('[P2] 負値エントリ (取消) も total_point 同期 (== SUM)', async () => {
		const childId = await newChild('取消次郎');
		await pointRepo.insertPointEntry(
			{ childId, amount: 20, type: 'activity', description: '記録' },
			FAMILY,
		);
		await pointRepo.insertPointEntry(
			{ childId, amount: -8, type: 'activity_cancel', description: '取消' },
			FAMILY,
		);
		expect(await totalPointOf(childId)).toBe(12);
		expect(await pointRepo.getBalance(childId, FAMILY)).toBe(12);
		await expectNoDrift(childId);
	});

	it('[P3] child 不在への insert は throw + ledger 未挿入 (片肺書込 rollback)', async () => {
		const ghost = asChildId('00000000-0000-4000-8000-00000000dead');
		await expect(
			pointRepo.insertPointEntry(
				{ childId: ghost, amount: 10, type: 'activity', description: 'x' },
				FAMILY,
			),
		).rejects.toThrow();
		const rows = await t.db.execute(
			sql`SELECT count(*) AS c FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${String(ghost)}`,
		);
		expect(Number((rows.rows[0] as { c: unknown }).c)).toBe(0);
	});

	it('[P4] getBalance = children.total_point 単読 (SUM 再計算しない、§5 compute-on-write)', async () => {
		const childId = await newChild('残高三郎');
		await pointRepo.insertPointEntry(
			{ childId, amount: 30, type: 'activity', description: '記録' },
			FAMILY,
		);
		// 列を意図的に skew: getBalance が SUM でなく列を読むことの直接証明
		await t.db.execute(
			sql`UPDATE children SET total_point = 999 WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}`,
		);
		expect(await pointRepo.getBalance(childId, FAMILY)).toBe(999);
		// 後始末 (他テストの drift assert を汚さない)
		await t.db.execute(
			sql`UPDATE children SET total_point = 30 WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}`,
		);
	});

	it('[P5] findPointHistory: created_at 降順 + limit/offset + shape parity', async () => {
		const childId = await newChild('履歴四郎');
		for (const [amount, type] of [
			[1, 'a'],
			[2, 'b'],
			[3, 'c'],
		] as const) {
			await pointRepo.insertPointEntry(
				{ childId, amount, type, description: `entry-${amount}` },
				FAMILY,
			);
		}
		const page1 = await pointRepo.findPointHistory(childId, { limit: 2, offset: 0 }, FAMILY);
		expect(page1.map((e) => e.amount)).toEqual([3, 2]); // 新しい順
		const page2 = await pointRepo.findPointHistory(childId, { limit: 2, offset: 2 }, FAMILY);
		expect(page2.map((e) => e.amount)).toEqual([1]);
	});

	it('[P6] spendPointsAtomic 成功: 負値エントリ + total_point 減算 (== SUM)', async () => {
		const childId = await newChild('消費五郎');
		await pointRepo.insertPointEntry(
			{ childId, amount: 50, type: 'activity', description: '貯金' },
			FAMILY,
		);
		const result = await pointRepo.spendPointsAtomic(
			childId,
			30,
			{ type: 'reward_redeem', description: 'ごほうび交換', referenceId: 'reward-1' },
			FAMILY,
		);
		expect(result).not.toHaveProperty('error');
		if ('error' in result) throw new Error('unreachable');
		expect(result.amount).toBe(-30);
		expect(result.type).toBe('reward_redeem');
		expect(result.referenceId).toBe('reward-1');
		expect(await pointRepo.getBalance(childId, FAMILY)).toBe(20);
		await expectNoDrift(childId);
	});

	it('[P7] spendPointsAtomic 残高不足: INSUFFICIENT_POINTS + 無書込', async () => {
		const childId = await newChild('不足六郎');
		await pointRepo.insertPointEntry(
			{ childId, amount: 10, type: 'activity', description: '少額' },
			FAMILY,
		);
		const result = await pointRepo.spendPointsAtomic(
			childId,
			11,
			{ type: 'reward_redeem', description: '買えない' },
			FAMILY,
		);
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
		expect(await pointRepo.getBalance(childId, FAMILY)).toBe(10);
		const rows = await t.db.execute(sql`
			SELECT count(*) AS c FROM point_ledger
			WHERE family_id = ${FAMILY} AND child_id = ${String(childId)} AND amount < 0
		`);
		expect(Number((rows.rows[0] as { c: unknown }).c)).toBe(0);
		await expectNoDrift(childId);
	});

	it('[P8] §P9 tenant 分離: 他 family から不可視 + spend 不能', async () => {
		const childId = await newChild('分離七郎');
		await pointRepo.insertPointEntry(
			{ childId, amount: 40, type: 'activity', description: '自家' },
			FAMILY,
		);
		expect(await pointRepo.getBalance(childId, OTHER_FAMILY)).toBe(0);
		expect(
			await pointRepo.findPointHistory(childId, { limit: 10, offset: 0 }, OTHER_FAMILY),
		).toEqual([]);
		expect(await pointRepo.findChildById(childId, OTHER_FAMILY)).toBeUndefined();
		const result = await pointRepo.spendPointsAtomic(
			childId,
			10,
			{ type: 'reward_redeem', description: '越境' },
			OTHER_FAMILY,
		);
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
		expect(await pointRepo.getBalance(childId, FAMILY)).toBe(40); // 無傷
	});

	it('[P9] deletePointLedgerBeforeDate: cutoff 前だけ削除・total_point 不触 (carryover 廃止)', async () => {
		const childId = await newChild('保持八郎');
		const id = String(childId);
		// 古いエントリ 2 件 (cutoff 前) + 新しいエントリ 1 件を直接 seed
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, recorded_date, created_at)
			VALUES
				(${FAMILY}, ${id}, 10, 'activity', '2025-01-10', '2025-01-10T00:00:00Z'),
				(${FAMILY}, ${id}, 5, 'bonus', '2025-02-10', '2025-02-10T00:00:00Z'),
				(${FAMILY}, ${id}, 7, 'activity', '2026-06-01', '2026-06-01T00:00:00Z')
		`);
		await t.db.execute(
			sql`UPDATE children SET total_point = 22 WHERE family_id = ${FAMILY} AND child_id = ${id}`,
		);

		const deleted = await pointRepo.deletePointLedgerBeforeDate(childId, '2026-01-01', FAMILY);
		expect(deleted).toBe(2);
		// reset-plan 決定#4 / #729: total_point は authoritative な残高で不触 → 残高不変
		expect(await pointRepo.getBalance(childId, FAMILY)).toBe(22);
		const remaining = await t.db.execute(sql`
			SELECT amount, type FROM point_ledger
			WHERE family_id = ${FAMILY} AND child_id = ${id} ORDER BY amount
		`);
		const rows = remaining.rows as { amount: number; type: string }[];
		// carryover 廃止: 残るのは cutoff 後の 1 件のみ (繰越エントリを作らない)
		expect(rows).toHaveLength(1);
		expect(rows[0]?.amount).toBe(7);
		expect(rows.some((r) => r.type === 'carryover')).toBe(false);
		// pruning 後は SUM(=7) < total_point(=22) となるのが仕様 (fitness#14 は非 pruning scope)
	});

	it('[P9c] #4722 deleteStatusHistoryBeforeDate の境界は JST 深夜 0:00 (point_ledger と同基準)', async () => {
		const childId = await newChild('境界十郎');
		const id = String(childId);
		const catId = String(asCategoryId(3));
		// 本番 DSQL は session TZ=UTC 固定 (§P10)。PGlite は起動環境のローカル TZ を継承するため、
		// **UTC に固定してから**検証する (JST マシンだと session TZ 依存の欠陥が偶然通ってしまう)。
		await t.db.execute(sql`SET TIME ZONE 'UTC'`);
		// 境界日 (2026-06-01) の JST 0〜9 時 = UTC 前日 15〜24 時。JST 基準なら「境界日当日」= 残す。
		// 旧実装は session TZ (UTC) の 0:00 を境界にしていたため、この行を 1 日早く消していた。
		await t.db.execute(sql`
			INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
			VALUES
				(${FAMILY}, ${id}, ${catId}, 10, 1, 'activity_record', '2026-05-31T15:30:00Z'),
				(${FAMILY}, ${id}, ${catId}, 11, 1, 'activity_record', '2026-05-31T10:00:00Z')
		`);

		const deleted = await statusRepo.deleteStatusHistoryBeforeDate(childId, '2026-06-01', FAMILY);
		// JST 2026-06-01 00:30 の行 (UTC 5/31 15:30) は保持、JST 5/31 19:00 の行 (UTC 10:00) だけ削除
		expect(deleted).toBe(1);
		const rows = await t.db.execute(sql`
			SELECT count(*)::int AS c FROM status_history WHERE family_id = ${FAMILY} AND child_id = ${id}
		`);
		expect(Number((rows.rows[0] as { c: number }).c)).toBe(1);
	});

	it('[P9d] #4722 deletePointLedgerBeforeDate も同じ JST 境界 (2 表で基準が割れない)', async () => {
		const childId = await newChild('境界十一郎');
		const id = String(childId);
		await t.db.execute(sql`SET TIME ZONE 'UTC'`);
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, recorded_date, created_at)
			VALUES
				(${FAMILY}, ${id}, 3, 'activity', '2026-06-01', '2026-05-31T15:30:00Z'),
				(${FAMILY}, ${id}, 4, 'activity', '2026-05-31', '2026-05-31T10:00:00Z')
		`);
		const deleted = await pointRepo.deletePointLedgerBeforeDate(childId, '2026-06-01', FAMILY);
		expect(deleted).toBe(1); // JST 6/1 00:30 の行は残る
	});

	it('[P9b] deletePointLedgerBeforeDate: 対象 0 件は何も書かない (carryover 生成 0)', async () => {
		const childId = await newChild('保持九郎');
		await pointRepo.insertPointEntry(
			{ childId, amount: 3, type: 'activity', description: '最近' },
			FAMILY,
		);
		const deleted = await pointRepo.deletePointLedgerBeforeDate(childId, '2020-01-01', FAMILY);
		expect(deleted).toBe(0);
		const rows = await t.db.execute(
			sql`SELECT count(*) AS c FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}`,
		);
		expect(Number((rows.rows[0] as { c: unknown }).c)).toBe(1); // 繰越なし・元 1 件のまま
	});

	it('[P9c] deletePointLedgerBeforeDate: cutoff を JST 深夜 0:00 境界で TZ-qualified 解釈する (#3593 ②)', async () => {
		// #3593 ②: cutoffDate は JST 当日境界。deletePointLedgerBeforeDate は
		// `created_at < cutoffDate::timestamptz` を session TZ 依存で解釈してはならない。
		// session TZ を UTC に固定した状態で「JST cutoff 当日の未明 (UTC 前日 20:00) の明細」が
		// 保持 (非削除) されることを検証する。旧実装 (session TZ 依存) では UTC 深夜 0:00 境界に
		// なり、この明細を誤って削除してしまう。
		await t.db.execute(sql`SET TIME ZONE 'UTC'`);
		const childId = await newChild('境界十二郎');
		const id = String(childId);
		// Row A: created_at 2026-01-14T20:00Z = JST 2026-01-15 05:00 (business day = cutoff 当日) → 保持
		// Row B: created_at 2026-01-14T10:00Z = JST 2026-01-14 19:00 (cutoff 前日) → 削除
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, recorded_date, created_at)
			VALUES
				(${FAMILY}, ${id}, 10, 'activity', '2026-01-15', '2026-01-14T20:00:00Z'),
				(${FAMILY}, ${id}, 5, 'activity', '2026-01-14', '2026-01-14T10:00:00Z')
		`);
		await t.db.execute(
			sql`UPDATE children SET total_point = 15 WHERE family_id = ${FAMILY} AND child_id = ${id}`,
		);

		const deleted = await pointRepo.deletePointLedgerBeforeDate(childId, '2026-01-15', FAMILY);
		// JST 境界解釈: cutoff 前日の Row B (5) のみ削除。cutoff 当日未明の Row A (10) は保持。
		expect(deleted).toBe(1);
		const remaining = await t.db.execute(sql`
			SELECT amount FROM point_ledger
			WHERE family_id = ${FAMILY} AND child_id = ${id} ORDER BY amount
		`);
		const rows = remaining.rows as { amount: number }[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.amount).toBe(10); // JST cutoff 当日の明細は残る
	});

	it('[P11] spendPointsAtomic 二重引落: FOR UPDATE で残高非負維持 (I-BAL-NONNEG)', async () => {
		// I-BAL-NONNEG (§6.6, F7): 残高 30 に対し 20 の spend を 2 本並行させる。FOR UPDATE の
		// write-intent により高々 1 本のみ成功し、最終残高は非負 (真の 40001 write-skew 阻止は
		// PoC 検証6 実測確定。PGlite は単一接続ゆえ直列化されるが「二重減算・overspend しない」
		// 不変条件は本 test で検証する)。
		const childId = await newChild('二重引落太郎');
		await pointRepo.insertPointEntry(
			{ childId, amount: 30, type: 'activity', description: '貯金' },
			FAMILY,
		);
		const spend = () =>
			pointRepo.spendPointsAtomic(
				childId,
				20,
				{ type: 'reward_redeem', description: '交換' },
				FAMILY,
			);
		const results = await Promise.all([spend(), spend()]);
		const successes = results.filter((r) => !('error' in r)).length;
		const failures = results.filter((r) => 'error' in r).length;
		expect(successes).toBe(1); // overspend しない (両成功は残高 -10 を意味し不可)
		expect(failures).toBe(1);
		const balance = await pointRepo.getBalance(childId, FAMILY);
		expect(balance).toBe(10);
		expect(balance).toBeGreaterThanOrEqual(0); // 残高マイナス不能
		await expectNoDrift(childId);
	});

	it('[P10] deleteByTenantId: ledger 全削除 + total_point 0 (== SUM 維持)、他 tenant 無傷', async () => {
		const mine = await newChild('全削除十郎', OTHER_FAMILY);
		const other = await newChild('無傷十一郎');
		await pointRepo.insertPointEntry(
			{ childId: mine, amount: 25, type: 'activity', description: 'x' },
			OTHER_FAMILY,
		);
		await pointRepo.insertPointEntry(
			{ childId: other, amount: 9, type: 'activity', description: 'y' },
			FAMILY,
		);

		await pointRepo.deleteByTenantId(OTHER_FAMILY);

		expect(await pointRepo.getBalance(mine, OTHER_FAMILY)).toBe(0);
		const gone = await t.db.execute(
			sql`SELECT count(*) AS c FROM point_ledger WHERE family_id = ${OTHER_FAMILY}`,
		);
		expect(Number((gone.rows[0] as { c: unknown }).c)).toBe(0);
		expect(await pointRepo.getBalance(other, FAMILY)).toBe(9); // 他 tenant 無傷
		await expectNoDrift(other);
		await expectNoDrift(mine);
	});

	it('point-repo findChildById: Child entity round-trip (child-repo parity)', async () => {
		const childId = await newChild('存在確認');
		const found = await pointRepo.findChildById(childId, FAMILY);
		expect(found?.nickname).toBe('存在確認');
		expect(found?.age).toBe(8);
		expect(found?.isArchived).toBe(0);
	});

	it('[P12] child 削除で PII (children 行) + point_ledger が同一 txn 消去される (#3593 ③ 退会 PII)', async () => {
		// #3593 ③: point-repo.deleteByTenantId は ledger のみ削除する primitive (children 行 =
		// nickname/birth_date PII は不触)。退会時の PII 物理消去は child 削除 cascade
		// (deleteChild → children + child-scoped 全表を同一 txn 削除) が担う。本 test は
		// 「child を消すと point_ledger も children (PII) も両方消える」cutover 配線を回帰固定する。
		const childId = await newChild('退会PII太郎');
		const id = String(childId);
		await pointRepo.insertPointEntry(
			{ childId, amount: 40, type: 'activity', description: 'x' },
			FAMILY,
		);
		// 削除前: children (PII) + point_ledger の双方が存在
		const beforeChild = await pointRepo.findChildById(childId, FAMILY);
		expect(beforeChild?.nickname).toBe('退会PII太郎');
		const ledgerCount = async () => {
			const r = await t.db.execute(
				sql`SELECT count(*)::int AS c FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${id}`,
			);
			return Number((r.rows[0] as { c: number }).c);
		};
		expect(await ledgerCount()).toBe(1);

		await childRepo.deleteChild(childId, FAMILY);

		// 削除後: children 行 (PII) が消え、point_ledger も消えている
		const piiRow = await t.db.execute(
			sql`SELECT nickname, birth_date FROM children WHERE family_id = ${FAMILY} AND child_id = ${id}`,
		);
		expect(piiRow.rows).toHaveLength(0);
		expect(await pointRepo.findChildById(childId, FAMILY)).toBeUndefined();
		expect(await ledgerCount()).toBe(0);
	});

	// ─────────────────── IStatusRepo ───────────────────

	it('[S1] upsertStatus: insert → update (負 XP は 0 clamp) + shape', async () => {
		const childId = await newChild('ステータス一郎');
		const catId = asCategoryId('exercise');
		const created = await statusRepo.upsertStatus(childId, catId, 100, 2, 100, FAMILY);
		expect(created.childId).toBe(childId);
		expect(created.categoryId).toBe(catId);
		expect(created.totalXp).toBe(100);
		expect(created.level).toBe(2);
		expect(created.peakXp).toBe(100);
		expect(typeof created.id).toBe('string');
		expect(typeof created.updatedAt).toBe('string');

		// update 経路 + 負 XP clamp (sqlite parity: Math.max(0, totalXp))
		const updated = await statusRepo.upsertStatus(childId, catId, -5, 1, 100, FAMILY);
		expect(updated.totalXp).toBe(0);
		expect(updated.peakXp).toBe(100);
		const all = await statusRepo.findStatuses(childId, FAMILY);
		expect(all).toHaveLength(1); // upsert であり重複行を作らない
	});

	it('[S2] findStatuses / findStatus + §P9 tenant 分離', async () => {
		const childId = await newChild('ステータス二郎');
		await statusRepo.upsertStatus(childId, asCategoryId('study'), 10, 1, 10, FAMILY);
		await statusRepo.upsertStatus(childId, asCategoryId('exercise'), 20, 1, 20, FAMILY);

		const all = await statusRepo.findStatuses(childId, FAMILY);
		expect(all).toHaveLength(2);
		const one = await statusRepo.findStatus(childId, asCategoryId('study'), FAMILY);
		expect(one?.totalXp).toBe(10);
		expect(await statusRepo.findStatus(childId, asCategoryId('none'), FAMILY)).toBeUndefined();

		expect(await statusRepo.findStatuses(childId, OTHER_FAMILY)).toEqual([]);
		expect(
			await statusRepo.findStatus(childId, asCategoryId('study'), OTHER_FAMILY),
		).toBeUndefined();
		expect(await statusRepo.findChildById(childId, OTHER_FAMILY)).toBeUndefined();
	});

	it('[S3] insertStatusHistory → findRecentStatusHistory (降順 + limit 既定 7)', async () => {
		const childId = await newChild('履歴三郎');
		const catId = asCategoryId('life');
		for (let i = 1; i <= 9; i++) {
			const entry = await statusRepo.insertStatusHistory(
				{
					childId,
					categoryId: catId,
					value: i * 10,
					changeAmount: 10,
					changeType: 'activity_record',
				},
				FAMILY,
			);
			expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(entry.value).toBe(i * 10);
			// defaultNow() は同一ループ内で同時刻になり得る (PGlite/実 DSQL 共通) ため、
			// 順序契約のテストとして recorded_at を明示的に単調化する。実装側は同時刻でも
			// 決定的になるよう history_id の tie-breaker を持つ (flake 根治 2026-07-04)。
			await t.db.execute(sql`
				UPDATE status_history SET recorded_at = ${`2026-07-04T00:00:0${i - 1}.000Z`}
				WHERE family_id = ${FAMILY} AND hist_id = ${String(entry.id)}
			`);
		}
		const recent = await statusRepo.findRecentStatusHistory(childId, catId, FAMILY);
		expect(recent).toHaveLength(7); // 既定 limit
		expect(recent[0]?.value).toBe(90); // 新しい順
		const limited = await statusRepo.findRecentStatusHistory(childId, catId, FAMILY, 2);
		expect(limited.map((e) => e.value)).toEqual([90, 80]);
	});

	it('[S4] findStatusValueAtDate: 指定日前の最新値 / 該当なし null', async () => {
		const childId = await newChild('時点四郎');
		const catId = asCategoryId('social');
		await t.db.execute(sql`
			INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
			VALUES
				(${FAMILY}, ${String(childId)}, 'social', 10, 10, 'activity_record', '2026-01-05T00:00:00Z'),
				(${FAMILY}, ${String(childId)}, 'social', 25, 15, 'activity_record', '2026-02-05T00:00:00Z')
		`);
		expect(await statusRepo.findStatusValueAtDate(childId, catId, '2026-02-01', FAMILY)).toBe(10);
		expect(await statusRepo.findStatusValueAtDate(childId, catId, '2026-03-01', FAMILY)).toBe(25);
		expect(await statusRepo.findStatusValueAtDate(childId, catId, '2025-12-01', FAMILY)).toBe(null);
	});

	it('[S8] deleteStatusHistoryBeforeDate: cutoff 前だけ削除 + tenant 分離 (#3518-2 retention)', async () => {
		const childId = await newChild('剪定八郎');
		const id = String(childId);
		await t.db.execute(sql`
			INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
			VALUES
				(${FAMILY}, ${id}, 'social', 10, 10, 'daily_decay', '2025-01-05T00:00:00Z'),
				(${FAMILY}, ${id}, 'social', 20, 10, 'daily_decay', '2025-06-05T00:00:00Z'),
				(${FAMILY}, ${id}, 'study', 30, 30, 'activity_record', '2026-06-05T00:00:00Z')
		`);
		// 他 tenant の同 child_id 行は消さない (tenant 分離)
		const otherChild = await newChild('剪定九郎', OTHER_FAMILY);
		await t.db.execute(sql`
			INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
			VALUES (${OTHER_FAMILY}, ${String(otherChild)}, 'social', 5, 5, 'daily_decay', '2025-01-05T00:00:00Z')
		`);

		// cutoff = 2026-01-01: 2025 の 2 行 (全カテゴリ) が削除、2026 行は残る
		const deleted = await statusRepo.deleteStatusHistoryBeforeDate(childId, '2026-01-01', FAMILY);
		expect(deleted).toBe(2);

		const remain = await t.db.execute(
			sql`SELECT count(*)::int AS c FROM status_history WHERE family_id = ${FAMILY} AND child_id = ${id}`,
		);
		expect(Number((remain.rows[0] as { c: number }).c)).toBe(1);

		// 他 tenant 行は無傷
		const other = await t.db.execute(
			sql`SELECT count(*)::int AS c FROM status_history WHERE family_id = ${OTHER_FAMILY}`,
		);
		expect(Number((other.rows[0] as { c: number }).c)).toBe(1);

		// 対象 0 件は 0 を返す
		expect(await statusRepo.deleteStatusHistoryBeforeDate(childId, '2020-01-01', FAMILY)).toBe(0);
	});

	it('[S5] benchmark upsert/find: グローバル master (tenant 非依存、sqlite parity)', async () => {
		const catId = asCategoryId('exercise');
		const created = await statusRepo.upsertBenchmark(8, catId, 50, 10, 'survey-2026', FAMILY);
		expect(created.age).toBe(8);
		expect(created.categoryId).toBe(catId);
		expect(created.mean).toBe(50);
		expect(created.stdDev).toBe(10);
		expect(created.source).toBe('survey-2026');

		// 同 (age, category) への upsert は update (重複行を作らない)
		const updated = await statusRepo.upsertBenchmark(8, catId, 55, 12, 'survey-2027', FAMILY);
		expect(updated.mean).toBe(55);

		// グローバル master: tenant を跨いで同じものが見える
		const fromOther = await statusRepo.findBenchmark(8, catId, OTHER_FAMILY);
		expect(fromOther?.mean).toBe(55);

		await statusRepo.upsertBenchmark(6, asCategoryId('study'), 30, 5, 's', FAMILY);
		const all = await statusRepo.findAllBenchmarks(FAMILY);
		expect(all.length).toBeGreaterThanOrEqual(2);
		// (age, category) 昇順 (sqlite parity)
		const ages = all.map((b) => b.age);
		expect(ages).toEqual([...ages].sort((a, b) => a - b));
	});

	it('[S6] findLastActivityDates: activityId keyed (既存命名の歪み parity) + cancelled 除外', async () => {
		const childId = await newChild('活動五郎');
		const id = String(childId);
		const act = await t.db.execute(sql`
			INSERT INTO child_activities (family_id, child_id, name, category_id, icon)
			VALUES (${FAMILY}, ${id}, 'うんどう', 'exercise', '🏃') RETURNING activity_id
		`);
		const activityId = (act.rows[0] as { activity_id: string }).activity_id;
		await t.db.execute(sql`
			INSERT INTO activity_logs (family_id, child_id, activity_id, points, recorded_date, recorded_at, cancelled)
			VALUES
				(${FAMILY}, ${id}, ${activityId}, 10, '2026-06-01', now(), false),
				(${FAMILY}, ${id}, ${activityId}, 10, '2026-06-10', now(), false),
				(${FAMILY}, ${id}, ${activityId}, 10, '2026-06-20', now(), true)
		`);
		const dates = await statusRepo.findLastActivityDates(childId, FAMILY);
		expect(dates).toHaveLength(1);
		expect(dates[0]?.category).toBe(activityId); // uuid backend では activityId 文字列 keyed
		expect(dates[0]?.lastDate).toBe('2026-06-10'); // cancelled=true は除外
		expect(await statusRepo.findLastActivityDates(childId, OTHER_FAMILY)).toEqual([]);
	});

	it('[S7] deleteByTenantId: statuses/status_history 削除、benchmarks は survive', async () => {
		const mine = await newChild('状態六郎', OTHER_FAMILY);
		await statusRepo.upsertStatus(mine, asCategoryId('creative'), 10, 1, 10, OTHER_FAMILY);
		await statusRepo.insertStatusHistory(
			{
				childId: mine,
				categoryId: asCategoryId('creative'),
				value: 10,
				changeAmount: 10,
				changeType: 'x',
			},
			OTHER_FAMILY,
		);
		const keep = await newChild('状態七郎');
		await statusRepo.upsertStatus(keep, asCategoryId('creative'), 20, 1, 20, FAMILY);

		await statusRepo.deleteByTenantId(OTHER_FAMILY);

		expect(await statusRepo.findStatuses(mine, OTHER_FAMILY)).toEqual([]);
		const hist = await t.db.execute(
			sql`SELECT count(*) AS c FROM status_history WHERE family_id = ${OTHER_FAMILY}`,
		);
		expect(Number((hist.rows[0] as { c: unknown }).c)).toBe(0);
		expect((await statusRepo.findStatuses(keep, FAMILY)).length).toBe(1); // 他 tenant 無傷
		// グローバル master は削除しない (sqlite parity)
		expect((await statusRepo.findAllBenchmarks(FAMILY)).length).toBeGreaterThanOrEqual(2);
	});
});
