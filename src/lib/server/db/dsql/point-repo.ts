// src/lib/server/db/dsql/point-repo.ts
// EPIC #3424 / PR-R4 (M4-D point/ledger、経済整合の中核) / 設計 SSOT:
//   m2-logical-model.md §1.5 / m3-physical-model.md §5(P7) / §6.2 / §6.6 (I-BAL-NONNEG, F7) /
//   §11.2 / §P9 / reset-plan 決定#3・#4 (2026-07-05)
//
// IPointRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **point 書込単一プリミティブ (reset-plan 決定#3)**: 付与/取消は `createPointEntryWriter`
//     (point-write.ts) 1 経路に集約。ledger INSERT + total_point 加算を同一 txn で行う。
//     `IActivityRepo.insertPointLedger` も同 writer に委譲済 (重複プリミティブ廃止)。
//   - **total_point compute-on-write (§6.2 / §5 P7)**: total_point は point_ledger 書込と同一
//     txn で `+= amount` のみ更新。残高 read は children.total_point 単読 (SUM 再計算しない)。
//   - **裁量消費の残高非負 (I-BAL-NONNEG, §6.6, F7)**: spendPointsAtomic は残高行を
//     `SELECT … FOR UPDATE` で write-intent 化してから減算する。FOR UPDATE は DSQL 上で
//     write-conflict footprint を生み、二重引落 (write-skew / TOCTOU overspend) の一方を
//     40001 にして阻止する (PoC 検証6 実測確定)。plain read は footprint を生まないため
//     read-modify-write の非負不変条件には FOR UPDATE 必須。
//   - **carryover 廃止 (reset-plan 決定#4)**: retention (deletePointLedgerBeforeDate) は
//     古い ledger 行を削除するのみ・total_point 不触。total_point は authoritative な残高で
//     あり、過去明細の削除で残高は変わらない (#729「ポイントは消えず過去明細だけが消える」を
//     満たす)。`type='carryover'` エントリは生成しない。
//   - **fitness#14 再定義 (reset-plan 決定#4)**: 「total_point == SUM(全 ledger)」は pruning 後は
//     成り立たない (SUM < total_point)。本番正しさは単一プリミティブ + 同一 txn `+= amount` で
//     構造担保する。findTotalPointDrift は「pruning 前提の書込増分整合」をテストで検証する
//     helper に再定義 (derived-drift.ts 参照)。
//   - **fitness#7 準拠**: txn work 内の await は全て tx.execute 直呼び (helper 閉包禁止)。

import { sql } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import type { IPointRepo } from '../interfaces/point-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import { isUuidFormat } from './pg-uuid';
import { createPointEntryWriter, LEDGER_COLUMNS, type LedgerRow, toEntry } from './point-write';
import type { SqlExecutor } from './sql-executor';

/** DSQL 用 IPointRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlPointRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IPointRepo {
	// reset-plan 決定#3: 付与/取消は単一プリミティブ経由 (insertPointLedger も同 writer に委譲)。
	const insertPointEntry = createPointEntryWriter(runner);

	return {
		insertPointEntry,

		async getBalance(childId, tenantId) {
			// §6.2 compute-on-write: 残高は派生列の単読 (SUM スキャン廃止)。child 不在は 0。
			const result = await db.execute(sql`
				SELECT total_point FROM children
				WHERE family_id = ${tenantId} AND child_id = ${childId}
			`);
			const row = result.rows[0] as { total_point: number } | undefined;
			return Number(row?.total_point ?? 0);
		},

		async findPointHistory(childId, options, tenantId) {
			const result = await db.execute(sql`
				SELECT ${LEDGER_COLUMNS} FROM point_ledger
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY created_at DESC, ledger_id DESC
				LIMIT ${options.limit} OFFSET ${options.offset}
			`);
			return (result.rows as unknown as LedgerRow[]).map(toEntry);
		},

		async spendPointsAtomic(childId, amount, entry, tenantId) {
			// I-BAL-NONNEG (§6.6, F7): 残高行を FOR UPDATE で write-intent 化してから非負確認 →
			// 減算。並行 spend は同一 children 行の FOR UPDATE footprint が衝突し一方が 40001 →
			// retry → 減算後残高で INSUFFICIENT を返す (二重減算・残高マイナス不能、write-skew 阻止)。
			const recordedDate = todayDateJST();
			return runner.runInTransaction(async (tx) => {
				const balanceRead = await tx.execute(sql`
					SELECT total_point FROM children
					WHERE family_id = ${tenantId} AND child_id = ${childId}
					FOR UPDATE
				`);
				const row = balanceRead.rows[0] as { total_point: number } | undefined;
				const balance = Number(row?.total_point ?? 0);
				if (row === undefined || balance < amount) {
					return { error: 'INSUFFICIENT_POINTS' as const };
				}

				const inserted = await tx.execute(sql`
					INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date)
					VALUES (${tenantId}, ${childId}, ${-amount}, ${entry.type},
						${entry.description}, ${entry.referenceId ?? null}, ${recordedDate})
					RETURNING ${LEDGER_COLUMNS}
				`);
				await tx.execute(sql`
					UPDATE children SET total_point = total_point - ${amount}, updated_at = now()
					WHERE family_id = ${tenantId} AND child_id = ${childId}
				`);
				return toEntry(inserted.rows[0] as unknown as LedgerRow);
			});
		},

		async findChildById(id, tenantId) {
			// #3709: 非 uuid の stale id は 22P02 throw ではなく not-found に正規化 (pg-uuid.ts 参照)。
			if (!isUuidFormat(id)) return undefined;
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children
				WHERE family_id = ${tenantId} AND child_id = ${id}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async deleteByTenantId(tenantId) {
			// tenant 全削除 (退会経路)。ledger 全削除と同一 txn で total_point を 0 に揃え、
			// children 行が (削除順序の都合で) まだ残っていても残高 0 に確定させる。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`DELETE FROM point_ledger WHERE family_id = ${tenantId}`);
				await tx.execute(sql`
					UPDATE children SET total_point = 0, updated_at = now()
					WHERE family_id = ${tenantId} AND total_point <> 0
				`);
			});
		},

		async deletePointLedgerBeforeDate(childId, cutoffDate, tenantId) {
			// retention cleanup (#717/#729): cutoffDate (YYYY-MM-DD) 当日 0:00 前の明細を削除。
			// reset-plan 決定#4: carryover エントリは作らず total_point も触らない。total_point は
			// authoritative な残高であり、過去明細を消しても残高は変わらない (#729「ポイントは
			// 消えず過去明細だけが消える」)。pruning 後は SUM(ledger) < total_point となり得るが、
			// 本番正しさは単一プリミティブ + 同一 txn `+= amount` で構造担保する (fitness#14 再定義)。
			// #3593 ①: SqlExecutor は rowCount 非公開だが、`RETURNING ledger_id` を JS 側で数えると
			// 長期利用 child の大量明細で全 PK を client に materialize する scale/memory リスクがある。
			// CTE で削除行を DB 側 count(*) 集約し、返るのは単一スカラのみにする (carryover 廃止済 =
			// reset-plan 決定#4 のため SUM は不要、件数のみ。sqlite 版 `result.changes` と同じ count 契約)。
			const deleted = await db.execute(sql`
				WITH deleted AS (
					DELETE FROM point_ledger
					WHERE family_id = ${tenantId} AND child_id = ${childId}
						AND created_at < ${cutoffDate}::timestamptz
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM deleted
			`);
			return Number((deleted.rows[0] as { c: number }).c);
		},
	};
}
