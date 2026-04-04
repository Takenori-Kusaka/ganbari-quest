// src/lib/server/db/status-repo.ts
// ステータス関連のリポジトリ層

import { and, desc, eq, lt, max, sql } from 'drizzle-orm';
import { db } from '../client';
import { ENTITY_VERSIONS } from '../migration/registry';
import { SCHEMA_VERSION_FIELD } from '../migration/types';
import { activityLogs, children, marketBenchmarks, statuses, statusHistory } from '../schema';

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
export async function findStatuses(childId: number, _tenantId: string) {
	const rows = db.select().from(statuses).where(eq(statuses.childId, childId)).all();
	for (const row of rows) {
		if (row._sv == null || row._sv < ENTITY_VERSIONS.status.latest) {
			writeBackStatusSv(row.id);
			row._sv = ENTITY_VERSIONS.status.latest;
		}
	}
	return rows;
}

/** カテゴリ別のステータスを取得 */
export async function findStatus(childId: number, categoryId: number, _tenantId: string) {
	const row = db
		.select()
		.from(statuses)
		.where(and(eq(statuses.childId, childId), eq(statuses.categoryId, categoryId)))
		.get();
	if (row && (row._sv == null || row._sv < ENTITY_VERSIONS.status.latest)) {
		writeBackStatusSv(row.id);
		row._sv = ENTITY_VERSIONS.status.latest;
	}
	return row;
}

/** ステータスを更新（upsert） */
export async function upsertStatus(
	childId: number,
	categoryId: number,
	totalXp: number,
	level: number,
	peakXp: number,
	_tenantId: string,
) {
	const existing = await findStatus(childId, categoryId, _tenantId);
	const clampedXp = Math.max(0, totalXp);
	const now = new Date().toISOString();

	if (existing) {
		return db
			.update(statuses)
			.set({ totalXp: clampedXp, level, peakXp, updatedAt: now })
			.where(eq(statuses.id, existing.id))
			.returning()
			.get();
	}

	return db
		.insert(statuses)
		.values({
			childId,
			categoryId,
			totalXp: clampedXp,
			level,
			peakXp,
			updatedAt: now,
			[SCHEMA_VERSION_FIELD]: ENTITY_VERSIONS.status.latest,
		})
		.returning()
		.get();
}

/** ステータス変動履歴を追加 */
export async function insertStatusHistory(
	input: {
		childId: number;
		categoryId: number;
		value: number;
		changeAmount: number;
		changeType: string;
	},
	_tenantId: string,
) {
	return db.insert(statusHistory).values(input).returning().get();
}

/** 直近のステータス変動を取得 */
export async function findRecentStatusHistory(
	childId: number,
	categoryId: number,
	_tenantId: string,
	limit = 7,
) {
	return db
		.select()
		.from(statusHistory)
		.where(and(eq(statusHistory.childId, childId), eq(statusHistory.categoryId, categoryId)))
		.orderBy(desc(statusHistory.recordedAt))
		.limit(limit)
		.all();
}

/** 指定日時点のステータス値を取得（その日以前の最新のhistory entry） */
export async function findStatusValueAtDate(
	childId: number,
	categoryId: number,
	beforeDate: string,
	_tenantId: string,
): Promise<number | null> {
	const row = db
		.select({ value: statusHistory.value })
		.from(statusHistory)
		.where(
			and(
				eq(statusHistory.childId, childId),
				eq(statusHistory.categoryId, categoryId),
				lt(statusHistory.recordedAt, beforeDate),
			),
		)
		.orderBy(desc(statusHistory.recordedAt))
		.limit(1)
		.get();
	return row?.value ?? null;
}

/** 市場ベンチマークを取得 */
export async function findBenchmark(age: number, categoryId: number, _tenantId: string) {
	return db
		.select()
		.from(marketBenchmarks)
		.where(and(eq(marketBenchmarks.age, age), eq(marketBenchmarks.categoryId, categoryId)))
		.get();
}

/** 全ベンチマークを取得（年齢・カテゴリ順） */
export async function findAllBenchmarks(_tenantId: string) {
	return db
		.select()
		.from(marketBenchmarks)
		.orderBy(marketBenchmarks.age, marketBenchmarks.categoryId)
		.all();
}

/** ベンチマークをupsert */
export async function upsertBenchmark(
	age: number,
	categoryId: number,
	mean: number,
	stdDev: number,
	source: string,
	_tenantId: string,
) {
	const existing = await findBenchmark(age, categoryId, _tenantId);
	const now = new Date().toISOString();
	if (existing) {
		return db
			.update(marketBenchmarks)
			.set({ mean, stdDev, source, updatedAt: now })
			.where(eq(marketBenchmarks.id, existing.id))
			.returning()
			.get();
	}
	return db
		.insert(marketBenchmarks)
		.values({ age, categoryId, mean, stdDev, source })
		.returning()
		.get();
}

/** 子供の存在確認（年齢も取得） */
export async function findChildById(id: number, _tenantId: string) {
	const row = db.select().from(children).where(eq(children.id, id)).get();
	if (row && (row._sv == null || row._sv < ENTITY_VERSIONS.child.latest)) {
		try {
			db.run(
				sql`UPDATE children SET _sv = ${ENTITY_VERSIONS.child.latest} WHERE id = ${id} AND (_sv IS NULL OR _sv < ${ENTITY_VERSIONS.child.latest})`,
			);
		} catch {
			// Write-back failure is non-fatal
		}
		row._sv = ENTITY_VERSIONS.child.latest;
	}
	return row;
}

/** カテゴリ別の最終活動日を取得 */
export async function findLastActivityDates(childId: number, _tenantId: string) {
	return db
		.select({
			category: activityLogs.activityId,
			lastDate: max(activityLogs.recordedDate),
		})
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.activityId)
		.all();
}
