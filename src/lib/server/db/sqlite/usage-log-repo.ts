// src/lib/server/db/sqlite/usage-log-repo.ts
// 使用時間ログのリポジトリ層 (#1292)

import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { db } from '../client';
import { usageLogs } from '../schema';

/** セッション開始を記録 */
export async function insertUsageLog(input: {
	tenantId: string;
	childId: number;
	startedAt: string;
}) {
	return db.insert(usageLogs).values(input).returning().get();
}

/** セッション終了を記録 */
export async function updateUsageLogEnd(
	id: number,
	endedAt: string,
	durationSec: number,
	_tenantId: string,
) {
	return db
		.update(usageLogs)
		.set({ endedAt, durationSec })
		.where(eq(usageLogs.id, id))
		.returning()
		.get();
}

/** 進行中セッションを終了（cleanup用） */
export async function closeOpenSessions(childId: number, endedAt: string, _tenantId: string) {
	// 進行中（endedAt = NULL）のセッションをすべて終了させる
	const openSessions = await db
		.select()
		.from(usageLogs)
		.where(and(eq(usageLogs.childId, childId), isNull(usageLogs.endedAt)))
		.all();

	for (const session of openSessions) {
		const startMs = new Date(session.startedAt).getTime();
		const endMs = new Date(endedAt).getTime();
		const sec = Math.max(0, Math.floor((endMs - startMs) / 1000));
		await db
			.update(usageLogs)
			.set({ endedAt, durationSec: sec })
			.where(eq(usageLogs.id, session.id))
			.run();
	}
}

/** 本日の使用ログ一覧を取得（テナント全子供） */
export async function findTodayUsageLogs(tenantId: string, datePrefix: string) {
	// datePrefix = 'YYYY-MM-DD' でマッチする（ISO8601 prefix）
	return db
		.select()
		.from(usageLogs)
		.where(and(eq(usageLogs.tenantId, tenantId), gte(usageLogs.startedAt, datePrefix)))
		.all();
}

/** 指定日範囲の使用ログ一覧を取得（子供別） */
export async function findUsageLogsByChildAndDateRange(
	childId: number,
	tenantId: string,
	fromDate: string,
	toDate: string,
) {
	return db
		.select()
		.from(usageLogs)
		.where(
			and(
				eq(usageLogs.tenantId, tenantId),
				eq(usageLogs.childId, childId),
				gte(usageLogs.startedAt, fromDate),
				lt(usageLogs.startedAt, toDate),
			),
		)
		.orderBy(desc(usageLogs.startedAt))
		.all();
}

/** テナントの全使用ログを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(usageLogs).run();
}
