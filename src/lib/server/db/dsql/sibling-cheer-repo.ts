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
			// #3566 ②: from/to child ∈ family を INSERT ... SELECT JOIN children で構造強制。
			// caller は childId を渡すのみ (family 実在検証なし) だったため、他 family の child を
			// from/to に指定すると cross-family な cheer が書けてしまう余地があった。stamp-card の
			// insertEntry (#3562 ③) と同型に、両 child が同 tenant の children に実在する行だけを
			// 挿入する: cf = 送信元 (family_id=tenantId で絞る)、ct = 送信先 (cf と同 family で join)。
			// どちらかが不在なら SELECT が 0 行 → 挿入なし → RETURNING 空 → throw で拒否する。
			// family_id は children 行 (cf.family_id) から採り、tenantId 直書きより SSOT に忠実。
			const result = await db.execute(sql`
				INSERT INTO sibling_cheers (family_id, from_child_id, to_child_id, stamp_code)
				SELECT cf.family_id, cf.child_id, ct.child_id, ${input.stampCode}
				FROM children cf
				JOIN children ct ON ct.family_id = cf.family_id AND ct.child_id = ${input.toChildId}
				WHERE cf.family_id = ${tenantId} AND cf.child_id = ${input.fromChildId}
				RETURNING ${CHEER_COLUMNS}
			`);
			const row = result.rows[0] as unknown as CheerRow | undefined;
			if (!row) {
				// from / to のどちらかが tenant の children に不在 (cross-family 混入 or 不正 childId)。
				// 戻り値契約 (Promise<SiblingCheer>、非 null) を保つため throw で拒否する。
				throw new Error('sibling cheer insert rejected: from/to child not in family');
			}
			return toCheer(row);
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
