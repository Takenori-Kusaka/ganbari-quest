// src/lib/server/db/dsql/usage-log-repo.ts
// #4719: IUsageLogRepo の pg-core (Aurora DSQL / NUC PGlite) 実装。
//
// 設計契約:
//   - **factory 注入** (fitness#8: module-level db import 禁止)。単文更新のみで txn runner 不要。
//   - **§P9 tenant 述語**: 全クエリが family_id = tenantId を WHERE に含む。
//   - started_at / ended_at は timestamptz。入力は UTC ISO、読み出しは ISO (UTC、'Z' 終端) に正規化
//     して sqlite 実装 (ISO 文字列保存) と同じ shape を返す。
//   - 非 uuid の id / childId は 22P02 を避けて not-found 扱い (#3709 と同方針)。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import type { IUsageLogRepo, UsageLog } from '../interfaces/usage-log-repo.interface';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface UsageLogRow {
	family_id: string;
	child_id: string;
	log_id: string;
	started_at: string;
	ended_at: string | null;
	duration_sec: number | null;
}

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const COLUMNS = sql.raw(
	`family_id, child_id, log_id,
	 to_char(started_at AT TIME ZONE 'UTC', ${ISO_UTC}) AS started_at,
	 CASE WHEN ended_at IS NULL THEN NULL ELSE to_char(ended_at AT TIME ZONE 'UTC', ${ISO_UTC}) END AS ended_at,
	 duration_sec`,
);

function toUsageLog(row: UsageLogRow): UsageLog {
	return {
		id: row.log_id,
		tenantId: row.family_id,
		childId: asChildId(row.child_id),
		startedAt: row.started_at,
		endedAt: row.ended_at,
		durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
	};
}

export function createDsqlUsageLogRepo(db: SqlExecutor): IUsageLogRepo {
	return {
		async insertUsageLog(input) {
			const result = await db.execute(sql`
				INSERT INTO usage_logs (family_id, child_id, started_at)
				VALUES (${input.tenantId}, ${String(input.childId)}, ${input.startedAt}::timestamptz)
				RETURNING ${COLUMNS}
			`);
			return toUsageLog(result.rows[0] as unknown as UsageLogRow);
		},

		async updateUsageLogEnd(id, endedAt, durationSec, tenantId) {
			if (!isUuidFormat(id)) {
				warnInvalidUuidId('usage-log-repo.updateUsageLogEnd');
				return undefined;
			}
			const result = await db.execute(sql`
				UPDATE usage_logs SET ended_at = ${endedAt}::timestamptz, duration_sec = ${durationSec}
				WHERE family_id = ${tenantId} AND log_id = ${id}
				RETURNING ${COLUMNS}
			`);
			const row = result.rows[0] as unknown as UsageLogRow | undefined;
			return row ? toUsageLog(row) : undefined;
		},

		async closeOpenSessions(childId, endedAt, tenantId) {
			if (!isUuidFormat(String(childId))) {
				warnInvalidUuidId('usage-log-repo.closeOpenSessions');
				return;
			}
			// duration は DB 側で一括算出 (sqlite 実装の per-row 計算と同値: floor((end - start) 秒)、負は 0)。
			await db.execute(sql`
				UPDATE usage_logs
				SET ended_at = ${endedAt}::timestamptz,
					duration_sec = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${endedAt}::timestamptz - started_at))))::int
				WHERE family_id = ${tenantId} AND child_id = ${String(childId)} AND ended_at IS NULL
			`);
		},

		async findTodayUsageLogs(tenantId, startedAtFromIso) {
			const result = await db.execute(sql`
				SELECT ${COLUMNS} FROM usage_logs
				WHERE family_id = ${tenantId} AND started_at >= ${startedAtFromIso}::timestamptz
				ORDER BY started_at
			`);
			return (result.rows as unknown as UsageLogRow[]).map(toUsageLog);
		},

		async findUsageLogsByChildAndDateRange(childId, tenantId, fromDate, toDate) {
			if (!isUuidFormat(String(childId))) {
				warnInvalidUuidId('usage-log-repo.findUsageLogsByChildAndDateRange');
				return [];
			}
			const result = await db.execute(sql`
				SELECT ${COLUMNS} FROM usage_logs
				WHERE family_id = ${tenantId} AND child_id = ${String(childId)}
					AND started_at >= ${fromDate}::timestamptz AND started_at < ${toDate}::timestamptz
				ORDER BY started_at DESC
			`);
			return (result.rows as unknown as UsageLogRow[]).map(toUsageLog);
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM usage_logs WHERE family_id = ${tenantId}`);
		},
	};
}
