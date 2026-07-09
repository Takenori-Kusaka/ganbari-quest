// tests/unit/db/dsql-total-point-drift.test.ts
// EPIC #3424 / 実装 #3539 (#N4-1 Phase C) / 設計 SSOT: dsql-data-model.md §5(P7) / §13.1 fitness#14
//
// fitness#14「書込増分整合検証」(reset-plan 決定#4 で再定義):
//   children.total_point == SUM(point_ledger.amount) を **非 pruning scope** で突合する。
//   本番正しさの正本は「単一プリミティブ + 同一 txn `+= amount`」の構造担保であり、本突合は
//   書込経路が total_point を漏れなく共更新していることのテスト時検証。retention の pruning
//   (carryover 廃止、reset-plan 決定#4) を経ると SUM < total_point になるため本突合は成り立た
//   ない。以下の [D1-D3] は直接 seed した非 pruning データで書込増分整合を検証する。
//   ⚠️ optional 欠落 (point_ledger 行自体が書かれない) は drift=0 で検出不能 —
//   fitness#11 の欠落カウンタが補完する (§13.1、#N4-2 以降)。
//
// ── Canon TDD test list ──
//   [D1] total_point == SUM → drift 0 件
//   [D2] total_point != SUM → 当該 child のみ検出 (期待値/実測値付き)
//   [D3] ledger 0 行 + total_point != 0 も検出 (LEFT JOIN、初期化漏れ)

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FAMILY = '00000000-0000-4000-8000-0000000000aa';
const CHILD_OK = '00000000-0000-4000-8000-0000000000c1';
const CHILD_DRIFT = '00000000-0000-4000-8000-0000000000c2';
const CHILD_EMPTY = '00000000-0000-4000-8000-0000000000c3';

describe('fitness#14: children.total_point == SUM(point_ledger.amount) 突合 (§5 P7)', () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle>;

	beforeAll(async () => {
		client = new PGlite();
		db = drizzle(client);
		// 突合対象の最小列のみ再現 (完全 DDL は dsql/schema.ts が SSOT、fitness#9/#13 検証済)。
		await db.execute(
			sql.raw(`CREATE TABLE children (
				family_id uuid NOT NULL,
				child_id uuid NOT NULL,
				total_point integer NOT NULL DEFAULT 0,
				PRIMARY KEY (family_id, child_id)
			)`),
		);
		await db.execute(
			sql.raw(`CREATE TABLE point_ledger (
				family_id uuid NOT NULL,
				child_id uuid NOT NULL,
				ledger_id uuid NOT NULL DEFAULT gen_random_uuid(),
				amount integer NOT NULL,
				type text NOT NULL,
				recorded_date text NOT NULL,
				PRIMARY KEY (family_id, child_id, ledger_id)
			)`),
		);

		const seedLedger = (childId: string, amount: number) =>
			db.execute(sql`
				INSERT INTO point_ledger (family_id, child_id, amount, type, recorded_date)
				VALUES (${FAMILY}, ${childId}, ${amount}, 'base', '2026-07-02')
			`);

		// CHILD_OK: 10+5 = 15、total_point 15 (整合)
		await db.execute(
			sql`INSERT INTO children VALUES (${FAMILY}, ${CHILD_OK}, 15), (${FAMILY}, ${CHILD_DRIFT}, 100), (${FAMILY}, ${CHILD_EMPTY}, 7)`,
		);
		await seedLedger(CHILD_OK, 10);
		await seedLedger(CHILD_OK, 5);
		// CHILD_DRIFT: ledger 合計 20 だが total_point 100 (乖離)
		await seedLedger(CHILD_DRIFT, 20);
		// CHILD_EMPTY: ledger 0 行だが total_point 7 (初期化漏れ相当)
	});
	afterAll(async () => {
		await client.close();
	});

	it('[D1][D2][D3] 乖離 child のみ検出し、整合 child は返さない', async () => {
		const { findTotalPointDrift } = await import('../../../src/lib/server/db/dsql/derived-drift');
		const drifts = await findTotalPointDrift(db);
		const byChild = new Map(drifts.map((d) => [d.childId, d]));

		expect(byChild.has(CHILD_OK), '整合 child は drift 0').toBe(false);
		expect(byChild.get(CHILD_DRIFT)).toMatchObject({
			familyId: FAMILY,
			totalPoint: 100,
			ledgerSum: 20,
		});
		expect(byChild.get(CHILD_EMPTY), 'ledger 0 行でも LEFT JOIN で検出').toMatchObject({
			totalPoint: 7,
			ledgerSum: 0,
		});
		expect(drifts).toHaveLength(2);
	});
});
