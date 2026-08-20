// src/lib/server/db/point-repo.ts
// ポイント関連のリポジトリ層

import { and, desc, eq, lt, sql, sum } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import { children, pointLedger } from '../schema';
import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

type LedgerRow = typeof pointLedger.$inferSelect;

const toEntry = (r: LedgerRow): PointLedgerEntry => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	referenceId: r.referenceId === null ? null : String(r.referenceId),
});

/** ポイント残高を取得（point_ledgerのamount合計） */
export async function getBalance(childId: ChildId, _tenantId: string): Promise<number> {
	const result = db
		.select({ total: sum(pointLedger.amount) })
		.from(pointLedger)
		.where(eq(pointLedger.childId, Number(childId)))
		.get();

	return Number(result?.total ?? 0);
}

/** ポイント履歴を取得 */
export async function findPointHistory(
	childId: ChildId,
	options: { limit: number; offset: number },
	_tenantId: string,
): Promise<PointLedgerEntry[]> {
	return db
		.select()
		.from(pointLedger)
		.where(eq(pointLedger.childId, Number(childId)))
		.orderBy(desc(pointLedger.createdAt))
		.limit(options.limit)
		.offset(options.offset)
		.all()
		.map(toEntry);
}

/**
 * #4682 F2: 種別で絞った台帳一覧 (新しい順)。limit はその種別の表示件数。
 */
export async function findPointHistoryByType(
	childId: ChildId,
	options: { type: string; limit: number; offset?: number },
	_tenantId: string,
): Promise<PointLedgerEntry[]> {
	return db
		.select()
		.from(pointLedger)
		.where(and(eq(pointLedger.childId, Number(childId)), eq(pointLedger.type, options.type)))
		.orderBy(desc(pointLedger.createdAt))
		.limit(options.limit)
		.offset(options.offset ?? 0)
		.all()
		.map(toEntry);
}

/**
 * #4682 F2: 種別 (+ 期間) の SUM を DB 側で計算する (一覧 window 非依存)。
 *
 * `created_at` は CURRENT_TIMESTAMP 由来の `YYYY-MM-DD HH:MM:SS` (UTC) と ISO 文字列が
 * 混在しうるため、両辺を `datetime()` で正規化してから比較する (前方一致や生文字列比較だと
 * `T` 区切りの行を取りこぼす)。
 */
export async function sumPointsByType(
	childId: ChildId,
	options: { type: string; fromIso?: string; toIso?: string },
	_tenantId: string,
): Promise<number> {
	const conditions = [eq(pointLedger.childId, Number(childId)), eq(pointLedger.type, options.type)];
	if (options.fromIso) {
		conditions.push(sql`datetime(${pointLedger.createdAt}) >= datetime(${options.fromIso})`);
	}
	if (options.toIso) {
		conditions.push(sql`datetime(${pointLedger.createdAt}) < datetime(${options.toIso})`);
	}
	const row = db
		.select({ total: sum(pointLedger.amount) })
		.from(pointLedger)
		.where(and(...conditions))
		.get();
	return Number(row?.total ?? 0);
}

/** ポイント台帳にエントリを挿入 */
export async function insertPointEntry(
	input: InsertPointLedgerInput,
	_tenantId: string,
): Promise<PointLedgerEntry> {
	return toEntry(
		db
			.insert(pointLedger)
			.values({
				...input,
				childId: Number(input.childId),
				referenceId: input.referenceId !== undefined ? Number(input.referenceId) : undefined,
			})
			.returning()
			.get(),
	);
}

/**
 * #3347: 残高が `amount` 以上のときのみ、原子的にポイントを減算して台帳に負値エントリを挿入する。
 * better-sqlite3 の**同期トランザクション**で「残高再読込 → 非負確認 → 挿入」を 1 単位に閉じ込め、
 * 内部で await を挟まない。トランザクション中は他リクエストが event loop に割り込めないため、
 * 並行 / 二重 submit でも 2 回目は減算後の残高を読み INSUFFICIENT を返す（TOCTOU 二重減算・
 * 残高マイナスを構造的に防ぐ）。
 */
export async function spendPointsAtomic(
	childId: ChildId,
	amount: number,
	entry: { type: string; description: string; referenceId?: string },
	_tenantId: string,
): Promise<PointLedgerEntry | { error: 'INSUFFICIENT_POINTS' }> {
	return db.transaction((tx) => {
		const result = tx
			.select({ total: sum(pointLedger.amount) })
			.from(pointLedger)
			.where(eq(pointLedger.childId, Number(childId)))
			.get();
		const balance = Number(result?.total ?? 0);
		if (balance < amount) return { error: 'INSUFFICIENT_POINTS' as const };

		return toEntry(
			tx
				.insert(pointLedger)
				.values({
					childId: Number(childId),
					amount: -amount,
					type: entry.type,
					description: entry.description,
					referenceId: entry.referenceId !== undefined ? Number(entry.referenceId) : undefined,
				})
				.returning()
				.get(),
		);
	});
}

/** 子供の存在確認 */
export async function findChildById(id: ChildId, _tenantId: string): Promise<Child | undefined> {
	const row = db
		.select()
		.from(children)
		.where(eq(children.id, Number(id)))
		.get();
	return row ? { ...row, id: asChildId(row.id) } : undefined;
}

/** テナントの全ポイント台帳を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(pointLedger).run();
}

/**
 * 指定した子供の `created_at < cutoffDate` に該当する point_ledger を削除する。
 * cutoffDate は `YYYY-MM-DD` 形式。point_ledger.created_at は ISO timestamp 形式
 * (`YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SSZ`) で格納されているが、いずれも先頭の
 * 日付部分が辞書順で比較できるため、`created_at < cutoffDate` で安全に境界判定できる
 * （cutoffDate 当日は削除対象に含めない）。
 * #717, #729
 */
export async function deletePointLedgerBeforeDate(
	childId: ChildId,
	cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	const result = db
		.delete(pointLedger)
		.where(and(eq(pointLedger.childId, Number(childId)), lt(pointLedger.createdAt, cutoffDate)))
		.run();
	return result.changes;
}
