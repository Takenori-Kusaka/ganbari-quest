// src/lib/server/db/sqlite/usage-log-repo.ts
// 使用時間ログのリポジトリ層 (#1292)

import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import { usageLogs } from '../schema';

// #3575: read 境界で integer PK 行を string/branded id に変換して返す。
function toUsageLog(r: typeof usageLogs.$inferSelect) {
	return { ...r, id: String(r.id), childId: asChildId(r.childId) };
}

/** セッション開始を記録 */
export async function insertUsageLog(input: {
	tenantId: string;
	childId: ChildId;
	startedAt: string;
}) {
	const row = db
		.insert(usageLogs)
		.values({ ...input, childId: Number(input.childId) })
		.returning()
		.get();
	return toUsageLog(row);
}

/** セッション終了を記録 */
export async function updateUsageLogEnd(
	id: string,
	endedAt: string,
	durationSec: number,
	_tenantId: string,
) {
	const row = db
		.update(usageLogs)
		.set({ endedAt, durationSec })
		.where(eq(usageLogs.id, Number(id)))
		.returning()
		.get();
	return row ? toUsageLog(row) : row;
}

/** 進行中セッションを終了（cleanup用） */
export async function closeOpenSessions(childId: ChildId, endedAt: string, _tenantId: string) {
	// 進行中（endedAt = NULL）のセッションをすべて終了させる
	const openSessions = await db
		.select()
		.from(usageLogs)
		.where(and(eq(usageLogs.childId, Number(childId)), isNull(usageLogs.endedAt)))
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
export async function findTodayUsageLogs(tenantId: string, startedAtFromIso: string) {
	// startedAtFromIso = 「その日の始まり」を表す UTC ISO 文字列 (#4127)。
	// startedAt は UTC ISO で保存されるため、JST の 1 日で絞るには境界を
	// jstDayStartUtcIso() で作った瞬間で渡す (UTC 暦日の前方一致では 9 時間ずれる)。
	const rows = db
		.select()
		.from(usageLogs)
		.where(and(eq(usageLogs.tenantId, tenantId), gte(usageLogs.startedAt, startedAtFromIso)))
		.all();
	return rows.map(toUsageLog);
}

/** 指定日範囲の使用ログ一覧を取得（子供別） */
export async function findUsageLogsByChildAndDateRange(
	childId: ChildId,
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
				eq(usageLogs.childId, Number(childId)),
				gte(usageLogs.startedAt, fromDate),
				lt(usageLogs.startedAt, toDate),
			),
		)
		.orderBy(desc(usageLogs.startedAt))
		.all()
		.map(toUsageLog);
}

/** テナントの全使用ログを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(usageLogs).run();
}
