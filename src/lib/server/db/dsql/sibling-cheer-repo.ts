// src/lib/server/db/dsql/sibling-cheer-repo.ts
// EPIC #3424 / PR-R8 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ISiblingCheerRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全メソッドが単文のため TransactionRunner は不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **from/to の 2 child 参照 (family scope、§11.2)**: child 主軸にしない (PK は
//     (family_id, cheer_id))。entity の tenantId は family_id をそのまま写す。
//   - **countTodayCheersFrom は JST 当日境界**: sent_at は UTC timestamptz 格納のため、当日判定は
//     JST midnight (`<today>T00:00:00+09:00`) を境界に比較する (sqlite の naive 文字列比較より
//     tz 正確)。当日限度 (ADR-0012 anti-engagement) の 1 日単位を UTC ずれ無く数える。

import { sql } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import { asChildId } from '$lib/domain/ids';
import type { ISiblingCheerRepo } from '../interfaces/sibling-cheer-repo.interface';
import type { InsertSiblingCheerInput, SiblingCheer } from '../types';
import type { SqlExecutor } from './sql-executor';

interface CheerRow {
	cheer_id: string;
	family_id: string;
	from_child_id: string;
	to_child_id: string;
	stamp_code: string;
	sent_at: string;
	shown_at: string | null;
}

const CHEER_COLUMNS = sql.raw(
	'cheer_id, family_id, from_child_id, to_child_id, stamp_code, sent_at, shown_at',
);

/** row → SiblingCheer entity (tenantId = family_id を写像)。 */
function toCheer(row: CheerRow): SiblingCheer {
	return {
		id: String(row.cheer_id),
		fromChildId: asChildId(row.from_child_id),
		toChildId: asChildId(row.to_child_id),
		stampCode: row.stamp_code,
		tenantId: row.family_id,
		sentAt: row.sent_at,
		shownAt: row.shown_at,
	};
}

/** DSQL 用 ISiblingCheerRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlSiblingCheerRepo(db: SqlExecutor): ISiblingCheerRepo {
	return {
		async insertCheer(input: InsertSiblingCheerInput, tenantId) {
			const result = await db.execute(sql`
				INSERT INTO sibling_cheers (family_id, from_child_id, to_child_id, stamp_code)
				VALUES (${tenantId}, ${input.fromChildId}, ${input.toChildId}, ${input.stampCode})
				RETURNING ${CHEER_COLUMNS}
			`);
			return toCheer(result.rows[0] as unknown as CheerRow);
		},

		async findAllByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHEER_COLUMNS} FROM sibling_cheers
				WHERE family_id = ${tenantId}
				ORDER BY sent_at, cheer_id
			`);
			return (result.rows as unknown as CheerRow[]).map(toCheer);
		},

		async insertForRestore(input, tenantId) {
			// #3329: sent_at / shown_at を verbatim 書き戻す (from/to は呼び出し側が解決済)。
			const result = await db.execute(sql`
				INSERT INTO sibling_cheers
					(family_id, from_child_id, to_child_id, stamp_code, sent_at, shown_at)
				VALUES (${tenantId}, ${input.fromChildId}, ${input.toChildId}, ${input.stampCode},
					${input.sentAt}, ${input.shownAt})
				RETURNING ${CHEER_COLUMNS}
			`);
			return toCheer(result.rows[0] as unknown as CheerRow);
		},

		async findUnshownCheers(toChildId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHEER_COLUMNS} FROM sibling_cheers
				WHERE family_id = ${tenantId} AND to_child_id = ${toChildId} AND shown_at IS NULL
				ORDER BY sent_at, cheer_id
			`);
			return (result.rows as unknown as CheerRow[]).map(toCheer);
		},

		async markShown(cheerIds, tenantId) {
			if (cheerIds.length === 0) return;
			await db.execute(sql`
				UPDATE sibling_cheers SET shown_at = now()
				WHERE family_id = ${tenantId} AND cheer_id IN (${sql.join(
					cheerIds.map((id) => sql`${id}`),
					sql`, `,
				)})
			`);
		},

		async countTodayCheersFrom(fromChildId, tenantId) {
			// JST 当日境界 (§11.3 timestamptz): 今日 00:00 JST 以降を数える。
			const boundary = `${todayDateJST()}T00:00:00+09:00`;
			const result = await db.execute(sql`
				SELECT COUNT(*) AS count FROM sibling_cheers
				WHERE family_id = ${tenantId} AND from_child_id = ${fromChildId}
					AND sent_at >= ${boundary}::timestamptz
			`);
			const row = result.rows[0] as { count: number } | undefined;
			return Number(row?.count ?? 0);
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM sibling_cheers WHERE family_id = ${tenantId}`);
		},
	};
}
