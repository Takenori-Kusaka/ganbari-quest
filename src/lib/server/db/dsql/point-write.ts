// src/lib/server/db/dsql/point-write.ts
// EPIC #3424 / PR-R4 (M4-D point/ledger) / 設計 SSOT: m2-logical-model.md §1.5 /
//   m3-physical-model.md §5(P7) / §6.2 / reset-plan 決定#3 (point 書込単一プリミティブ)
//
// **point 書込の単一プリミティブ SSOT (reset-plan 決定#3)**。
//   付与/取消 (正・負・中立) の全 point_ledger 書込はこの 1 経路に集約する:
//     - `IPointRepo.insertPointEntry` は本 writer をそのまま公開する。
//     - `IActivityRepo.insertPointLedger` は本 writer に委譲する (戻り値を捨てる)。
//   これにより DSQL backend 内に INSERT + total_point 加算のコピーを 2 つ持たない
//   (reset-plan 決定#3: 重複プリミティブ廃止)。※ 裁量消費 (spendPointsAtomic) は残高非負
//   ガード (FOR UPDATE, I-BAL-NONNEG) を伴う別プリミティブ。
//   **optional 付与 (§8: core commit 後の独立 mini-txn) も本 writer を使う** (#4039)。
//   本 writer 自体が 1 回の呼び出し = 1 txn なので、core txn の外から呼べばそれがそのまま
//   optional の独立 mini-txn になり、§5 P7 (ledger INSERT と total_point 加算は同一 txn) も
//   満たす。専用の optional 変種 (旧 grant-optional-points.ts) は本 writer と同義の重複
//   プリミティブだったため #4039 で撤去した。
//
// **total_point compute-on-write (M3 §6.2 / §5 P7)**: ledger INSERT と同一 txn 内で
//   `children.total_point += amount` **のみ** を更新する (SUM 再計算の本番経路を作らない。
//   残高 = total_point 単読)。child 不在で total_point 更新先が無い場合は throw して txn
//   ごと rollback (片肺書込禁止)。
//
// **fitness#7 準拠**: runInTransaction work 内の await は全て tx.execute 直呼び。
//   本 writer は factory 関数内に runInTransaction を inline 展開しているため、委譲側
//   (insertPointLedger) は「txn work の中で」await するのではなく writer をそのまま呼ぶ
//   (helper 閉包を txn work に持ち込まない)。

import { sql } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import { asChildId } from '$lib/domain/ids';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { InsertPointLedgerInput, PointLedgerEntry } from '../types';
import type { SqlExecutor } from './sql-executor';

export interface LedgerRow {
	ledger_id: string;
	child_id: string;
	amount: number;
	type: string;
	description: string | null;
	reference_id: string | null;
	created_at: string;
}

/** point_ledger の共通 SELECT 列 (entity 未公開の recorded_date/family_id を含めない)。 */
export const LEDGER_COLUMNS = sql.raw(
	'ledger_id, child_id, amount, type, description, reference_id, created_at',
);

/** row → PointLedgerEntry (既存 sqlite backend と同一 shape)。 */
export function toEntry(row: LedgerRow): PointLedgerEntry {
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

/**
 * point 書込単一プリミティブを生成する (db/runner 注入、fitness#8)。
 * ledger INSERT + children.total_point 加算を同一 txn で実行し、挿入 entry を返す。
 */
export function createPointEntryWriter<TTx extends SqlExecutor>(
	runner: TransactionRunner<TTx>,
): (input: InsertPointLedgerInput, tenantId: string) => Promise<PointLedgerEntry> {
	return (input, tenantId) => {
		// recorded_date (NOT NULL、冪等 lookup 用 §11.2) は entity 未公開のため JST 今日で導出。
		const recordedDate = todayDateJST();
		return runner.runInTransaction(async (tx) => {
			const inserted = await tx.execute(sql`
				INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date)
				VALUES (${tenantId}, ${input.childId}, ${input.amount}, ${input.type},
					${input.description}, ${input.referenceId ?? null}, ${recordedDate})
				RETURNING ${LEDGER_COLUMNS}
			`);
			// §6.2 compute-on-write: total_point は同一 txn で += amount のみ更新 (SUM しない)。
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
	};
}
