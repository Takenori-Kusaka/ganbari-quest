// src/lib/server/db/dsql/point-repo.ts
// EPIC #3424 / PR-R4 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §5(P7) / §11.2 / §P9
//
// IPointRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **§5 P7 不変条件**: point_ledger を book (追加/取消) する全 write は、同一 txn で
//     children.total_point を同額共更新する (total_point == SUM(point_ledger.amount)、
//     fitness#14 findTotalPointDrift が突合)。child 不在で total_point 更新先が無い場合は
//     throw して txn ごと rollback (grant-optional-points.ts と同判断、片肺書込禁止)。
//   - **残高 read は children.total_point 単読** (§5 compute-on-write。SUM 再計算しない —
//     sqlite backend の SUM 実装との実装差は §5 で確定済の設計差分)。
//   - **fitness#7 準拠**: txn work 内の await は全て tx.execute 直呼び (helper 閉包禁止)。
//   - recorded_date (NOT NULL、冪等 lookup 用 §11.2) は InsertPointLedgerInput に無いため
//     JST 今日 (todayDateJST、recorded_date カラムの全既存経路と同基準) で導出する。
//   - retention (deletePointLedgerBeforeDate) は #729 設計「ポイントは消えず過去明細だけが
//     消える」(dynamodb backend の documented 契約) を維持しつつ §5 P7 と両立させるため、
//     削除合算の繰越 (carryover) エントリを同一 txn で挿入する (SUM 不変 = total_point 不変)。

import { sql } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import { asChildId } from '$lib/domain/ids';
import type { IPointRepo } from '../interfaces/point-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { PointLedgerEntry } from '../types';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import type { SqlExecutor } from './sql-executor';

interface LedgerRow {
	ledger_id: string;
	child_id: string;
	amount: number;
	type: string;
	description: string | null;
	reference_id: string | null;
	created_at: string;
}

const LEDGER_COLUMNS = sql.raw(
	'ledger_id, child_id, amount, type, description, reference_id, created_at',
);

/** row → PointLedgerEntry (既存 sqlite backend と同一 shape。recorded_date は entity 未公開)。 */
function toEntry(row: LedgerRow): PointLedgerEntry {
	return {
		id: row.ledger_id,
		childId: asChildId(row.child_id),
		amount: row.amount,
		type: row.type,
		description: row.description,
		referenceId: row.reference_id,
		createdAt: row.created_at,
	};
}

/** DSQL 用 IPointRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlPointRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IPointRepo {
	return {
		async getBalance(childId, tenantId) {
			// §5 compute-on-write: 残高は派生列の単読 (SUM スキャン廃止)。child 不在は 0。
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

		async insertPointEntry(input, tenantId) {
			// §5 P7: ledger INSERT + total_point 共更新を同一 txn (fitness#14 の乖離不能設計)。
			const recordedDate = todayDateJST();
			return runner.runInTransaction(async (tx) => {
				const inserted = await tx.execute(sql`
					INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date)
					VALUES (${tenantId}, ${input.childId}, ${input.amount}, ${input.type},
						${input.description}, ${input.referenceId ?? null}, ${recordedDate})
					RETURNING ${LEDGER_COLUMNS}
				`);
				const updated = await tx.execute(sql`
					UPDATE children SET total_point = total_point + ${input.amount}, updated_at = now()
					WHERE family_id = ${tenantId} AND child_id = ${input.childId}
					RETURNING child_id
				`);
				if (updated.rows.length === 0) {
					// child 不在 = total_point 共更新不能。throw で txn ごと rollback (§5 P7)。
					throw new Error(`insertPointEntry: child not found (${tenantId}/${input.childId})`);
				}
				return toEntry(inserted.rows[0] as unknown as LedgerRow);
			});
		},

		async spendPointsAtomic(childId, amount, entry, tenantId) {
			// #3347 TOCTOU 防止: DSQL は OCC — 残高 read と total_point UPDATE が同一 txn に
			// 閉じるため、並行 spend は children 行更新の衝突で 40001 → retry → 再読込が
			// 減算後残高で INSUFFICIENT を返す (二重減算・残高マイナス不能)。
			const recordedDate = todayDateJST();
			return runner.runInTransaction(async (tx) => {
				const balanceRead = await tx.execute(sql`
					SELECT total_point FROM children
					WHERE family_id = ${tenantId} AND child_id = ${childId}
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
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children
				WHERE family_id = ${tenantId} AND child_id = ${id}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async deleteByTenantId(tenantId) {
			// tenant 全削除 (退会経路)。ledger 全削除と同一 txn で total_point を 0 に揃え、
			// children 行が (削除順序の都合で) まだ残っていても §5 P7 不変条件を保つ。
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
			// #729 契約 = 「ポイントは消えず、過去明細だけが消える」(dynamodb backend と同義)。
			// §5 P7 (total_point == SUM) と両立させるため、削除分の合算を繰越 (carryover)
			// エントリとして同一 txn で挿入する — SUM 不変なので total_point は触らない。
			const recordedDate = todayDateJST();
			return runner.runInTransaction(async (tx) => {
				const deleted = await tx.execute(sql`
					DELETE FROM point_ledger
					WHERE family_id = ${tenantId} AND child_id = ${childId}
						AND created_at < ${cutoffDate}::timestamptz
					RETURNING amount
				`);
				const removedSum = (deleted.rows as { amount: number }[]).reduce(
					(acc, r) => acc + Number(r.amount),
					0,
				);
				if (deleted.rows.length > 0 && removedSum !== 0) {
					await tx.execute(sql`
						INSERT INTO point_ledger (family_id, child_id, amount, type, description, recorded_date)
						VALUES (${tenantId}, ${childId}, ${removedSum}, 'carryover',
							${'ポイント繰越（保持期間外の明細を合算）'}, ${recordedDate})
					`);
				}
				return deleted.rows.length;
			});
		},
	};
}
