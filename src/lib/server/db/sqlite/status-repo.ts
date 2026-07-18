// src/lib/server/db/status-repo.ts
// ステータス関連のリポジトリ層

import { and, desc, eq, lt, max, sql } from 'drizzle-orm';
import { asCategoryId, asChildId, type CategoryId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import { ENTITY_VERSIONS } from '../migration/registry';
import { SCHEMA_VERSION_FIELD } from '../migration/types';
import { activityLogs, children, marketBenchmarks, statuses, statusHistory } from '../schema';
import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';

type StatusRow = typeof statuses.$inferSelect;
type HistoryRow = typeof statusHistory.$inferSelect;
type BenchmarkRow = typeof marketBenchmarks.$inferSelect;

const toStatus = (r: StatusRow): Status => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	categoryId: asCategoryId(r.categoryId),
});

const toHistory = (r: HistoryRow): StatusHistoryEntry => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	categoryId: asCategoryId(r.categoryId),
});

const toBenchmark = (r: BenchmarkRow): MarketBenchmark => ({
	...r,
	id: String(r.id),
	categoryId: asCategoryId(r.categoryId),
});

/** SQLite: _sv が未設定のステータスレコードに最新バージョンを書き戻す */
function writeBackStatusSv(id: number): void {
	try {
		db.run(
			sql`UPDATE statuses SET _sv = ${ENTITY_VERSIONS.status.latest} WHERE id = ${id} AND (_sv IS NULL OR _sv < ${ENTITY_VERSIONS.status.latest})`,
		);
	} catch {
		// Write-back failure is non-fatal
	}
}

/** 子供の全ステータスを取得 */
export async function findStatuses(childId: ChildId, _tenantId: string): Promise<Status[]> {
	const rows = db
		.select()
		.from(statuses)
		.where(eq(statuses.childId, Number(childId)))
		.all();
	for (const row of rows) {
		if (row._sv == null || row._sv < ENTITY_VERSIONS.status.latest) {
			writeBackStatusSv(row.id);
			row._sv = ENTITY_VERSIONS.status.latest;
		}
	}
	return rows.map(toStatus);
}

/** カテゴリ別のステータスを取得 */
export async function findStatus(
	childId: ChildId,
	categoryId: CategoryId,
	_tenantId: string,
): Promise<Status | undefined> {
	const row = db
		.select()
		.from(statuses)
		.where(and(eq(statuses.childId, Number(childId)), eq(statuses.categoryId, Number(categoryId))))
		.get();
	if (row && (row._sv == null || row._sv < ENTITY_VERSIONS.status.latest)) {
		writeBackStatusSv(row.id);
		row._sv = ENTITY_VERSIONS.status.latest;
	}
	return row ? toStatus(row) : undefined;
}

/** ステータスを更新（upsert） */
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertStatus(
	childId: ChildId,
	categoryId: CategoryId,
	totalXp: number,
	level: number,
	peakXp: number,
	_tenantId: string,
): Promise<Status> {
	const existing = await findStatus(childId, categoryId, _tenantId);
	const clampedXp = Math.max(0, totalXp);
	const now = new Date().toISOString();

	if (existing) {
		return toStatus(
			db
				.update(statuses)
				.set({ totalXp: clampedXp, level, peakXp, updatedAt: now })
				.where(eq(statuses.id, Number(existing.id)))
				.returning()
				.get(),
		);
	}

	return toStatus(
		db
			.insert(statuses)
			.values({
				childId: Number(childId),
				categoryId: Number(categoryId),
				totalXp: clampedXp,
				level,
				peakXp,
				updatedAt: now,
				[SCHEMA_VERSION_FIELD]: ENTITY_VERSIONS.status.latest,
			})
			.returning()
			.get(),
	);
}

/** ステータス変動履歴を追加 */
export async function insertStatusHistory(
	input: InsertStatusHistoryInput,
	_tenantId: string,
): Promise<StatusHistoryEntry> {
	return toHistory(
		db
			.insert(statusHistory)
			.values({
				...input,
				childId: Number(input.childId),
				categoryId: Number(input.categoryId),
			})
			.returning()
			.get(),
	);
}

/** 直近のステータス変動を取得 */
export async function findRecentStatusHistory(
	childId: ChildId,
	categoryId: CategoryId,
	_tenantId: string,
	limit = 7,
): Promise<StatusHistoryEntry[]> {
	return db
		.select()
		.from(statusHistory)
		.where(
			and(
				eq(statusHistory.childId, Number(childId)),
				eq(statusHistory.categoryId, Number(categoryId)),
			),
		)
		.orderBy(desc(statusHistory.recordedAt))
		.limit(limit)
		.all()
		.map(toHistory);
}

/** 指定日時点のステータス値を取得（その日以前の最新のhistory entry） */
export async function findStatusValueAtDate(
	childId: ChildId,
	categoryId: CategoryId,
	beforeDate: string,
	_tenantId: string,
): Promise<number | null> {
	const row = db
		.select({ value: statusHistory.value })
		.from(statusHistory)
		.where(
			and(
				eq(statusHistory.childId, Number(childId)),
				eq(statusHistory.categoryId, Number(categoryId)),
				lt(statusHistory.recordedAt, beforeDate),
			),
		)
		.orderBy(desc(statusHistory.recordedAt))
		.limit(1)
		.get();
	return row?.value ?? null;
}

/** 市場ベンチマークを取得 */
export async function findBenchmark(
	age: number,
	categoryId: CategoryId,
	_tenantId: string,
): Promise<MarketBenchmark | undefined> {
	const row = db
		.select()
		.from(marketBenchmarks)
		.where(and(eq(marketBenchmarks.age, age), eq(marketBenchmarks.categoryId, Number(categoryId))))
		.get();
	return row ? toBenchmark(row) : undefined;
}

/** 全ベンチマークを取得（年齢・カテゴリ順） */
export async function findAllBenchmarks(_tenantId: string): Promise<MarketBenchmark[]> {
	return db
		.select()
		.from(marketBenchmarks)
		.orderBy(marketBenchmarks.age, marketBenchmarks.categoryId)
		.all()
		.map(toBenchmark);
}

/** ベンチマークをupsert */
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertBenchmark(
	age: number,
	categoryId: CategoryId,
	mean: number,
	stdDev: number,
	source: string,
	_tenantId: string,
): Promise<MarketBenchmark> {
	const existing = await findBenchmark(age, categoryId, _tenantId);
	const now = new Date().toISOString();
	if (existing) {
		return toBenchmark(
			db
				.update(marketBenchmarks)
				.set({ mean, stdDev, source, updatedAt: now })
				.where(eq(marketBenchmarks.id, Number(existing.id)))
				.returning()
				.get(),
		);
	}
	return toBenchmark(
		db
			.insert(marketBenchmarks)
			.values({ age, categoryId: Number(categoryId), mean, stdDev, source })
			.returning()
			.get(),
	);
}

/** 子供の存在確認（年齢も取得） */
export async function findChildById(id: ChildId, _tenantId: string): Promise<Child | undefined> {
	const idNum = Number(id);
	const row = db.select().from(children).where(eq(children.id, idNum)).get();
	if (row && (row._sv == null || row._sv < ENTITY_VERSIONS.child.latest)) {
		try {
			db.run(
				sql`UPDATE children SET _sv = ${ENTITY_VERSIONS.child.latest} WHERE id = ${idNum} AND (_sv IS NULL OR _sv < ${ENTITY_VERSIONS.child.latest})`,
			);
		} catch {
			// Write-back failure is non-fatal
		}
		row._sv = ENTITY_VERSIONS.child.latest;
	}
	return row ? { ...row, id: asChildId(row.id) } : undefined;
}

/** カテゴリ別の最終活動日を取得 */
export async function findLastActivityDates(childId: ChildId, _tenantId: string) {
	return db
		.select({
			category: activityLogs.activityId,
			lastDate: max(activityLogs.recordedDate),
		})
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, Number(childId)), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.activityId)
		.all();
}

/**
 * テナントの全ステータスデータを削除（SQLite: シングルテナントのため全行削除）。
 * market_benchmarks はグローバルなマスター/シードデータのため削除しない。
 */
/**
 * #3518-2 retention: 指定した子供の `recorded_at < cutoffDate` の status_history を削除する。
 * cutoffDate は `YYYY-MM-DD`。recorded_at は ISO timestamp で格納されるが、先頭日付部分が辞書順比較
 * できるため `recorded_at < cutoffDate` で cutoffDate 当日を含めず安全に境界判定できる
 * (point-repo.deletePointLedgerBeforeDate と同型)。
 */
export async function deleteStatusHistoryBeforeDate(
	childId: ChildId,
	cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	const result = db
		.delete(statusHistory)
		.where(
			and(eq(statusHistory.childId, Number(childId)), lt(statusHistory.recordedAt, cutoffDate)),
		)
		.run();
	return result.changes;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(statusHistory).run();
	db.delete(statuses).run();
}
