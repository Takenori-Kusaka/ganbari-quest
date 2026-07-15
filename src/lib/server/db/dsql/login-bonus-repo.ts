// src/lib/server/db/dsql/login-bonus-repo.ts
// EPIC #3424 / PR-R8 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ILoginBonusRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全メソッドが単文のため TransactionRunner は不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **自然複合 PK (family, child, login_date、§11.2 = ADR-0012 「1日1回」)**: surrogate id 列を
//     持たないため、entity の id は複合キーの合成文字列 (`child:login_date`) を返す
//     (daily-mission-repo の §11.2 自然キー戦略と同判断。LoginBonus.id の消費は表示 key のみで
//     grep 確認済)。
//   - **挿入冪等 (ON CONFLICT DO NOTHING)**: 同日再挿入は PK 衝突を silent skip し、既存行を
//     そのまま返す (1日1回)。sqlite backend の onConflictDoNothing().get() は衝突時 undefined を
//     返し得るが、DSQL 実装は既存行を再 SELECT して返すことで interface の non-null 契約を満たす。
//   - findChildById は child-repo の CHILD_COLUMNS / toChild を共有 (mapping 二重実装禁止)。

import { sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import type { ILoginBonusRepo } from '../interfaces/login-bonus-repo.interface';
import type { InsertLoginBonusInput, LoginBonus } from '../types';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import { isUuidFormat } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface LoginBonusRow {
	child_id: string;
	login_date: string;
	rank: string;
	base_points: number;
	multiplier: number;
	total_points: number;
	consecutive_days: number;
	created_at: string;
}

const LOGIN_BONUS_COLUMNS = sql.raw(
	`child_id, login_date, rank, base_points, multiplier, total_points, consecutive_days, created_at`,
);

/** row → LoginBonus entity (自然複合 PK: id は `child:login_date` 合成)。 */
function toLoginBonus(row: LoginBonusRow): LoginBonus {
	return {
		id: `${row.child_id}:${row.login_date}`,
		childId: asChildId(row.child_id),
		loginDate: row.login_date,
		rank: row.rank,
		basePoints: row.base_points,
		multiplier: row.multiplier,
		totalPoints: row.total_points,
		consecutiveDays: row.consecutive_days,
		createdAt: row.created_at,
	};
}

/** DSQL 用 ILoginBonusRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlLoginBonusRepo(db: SqlExecutor): ILoginBonusRepo {
	const findByDate = async (
		childId: ChildId,
		date: string,
		tenantId: string,
	): Promise<LoginBonus | undefined> => {
		const result = await db.execute(sql`
			SELECT ${LOGIN_BONUS_COLUMNS} FROM login_bonuses
			WHERE family_id = ${tenantId} AND child_id = ${childId} AND login_date = ${date}
		`);
		const row = result.rows[0] as unknown as LoginBonusRow | undefined;
		return row ? toLoginBonus(row) : undefined;
	};

	return {
		findTodayBonus(childId, today, tenantId) {
			return findByDate(childId, today, tenantId);
		},

		async findRecentBonuses(childId, tenantId, limit = 60) {
			const result = await db.execute(sql`
				SELECT ${LOGIN_BONUS_COLUMNS} FROM login_bonuses
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY login_date DESC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as LoginBonusRow[]).map(toLoginBonus);
		},

		async insertLoginBonus(input: InsertLoginBonusInput, tenantId) {
			// 自然複合 PK への ON CONFLICT DO NOTHING で冪等 (1日1回)。
			const result = await db.execute(sql`
				INSERT INTO login_bonuses
					(family_id, child_id, login_date, rank, base_points, multiplier, total_points,
					 consecutive_days)
				VALUES (${tenantId}, ${input.childId}, ${input.loginDate}, ${input.rank},
					${input.basePoints}, ${input.multiplier}, ${input.totalPoints}, ${input.consecutiveDays})
				ON CONFLICT (family_id, child_id, login_date) DO NOTHING
				RETURNING ${LOGIN_BONUS_COLUMNS}
			`);
			const row = result.rows[0] as unknown as LoginBonusRow | undefined;
			if (row) return toLoginBonus(row);
			// 衝突 (既に当日ボーナスあり): 既存行を返す (interface は non-null 契約)。
			const existing = await findByDate(input.childId, input.loginDate, tenantId);
			if (!existing) {
				throw new Error(
					`insertLoginBonus: conflict but existing row not found (${tenantId}/${input.childId}/${input.loginDate})`,
				);
			}
			return existing;
		},

		async findChildById(id, tenantId) {
			// #3709: 非 uuid の stale id は 22P02 throw ではなく not-found に正規化 (pg-uuid.ts 参照)。
			if (!isUuidFormat(id)) return undefined;
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children
				WHERE family_id = ${tenantId} AND child_id = ${id}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM login_bonuses WHERE family_id = ${tenantId}`);
		},

		async deleteLoginBonusesBeforeDate(childId, cutoffDate, tenantId) {
			// #717/#729: login_date < cutoffDate (strict less than、当日は残す)。
			// #3625: 削除件数は CTE で DB 側 count 集約し、削除全行を client に materialize しない。
			const result = await db.execute(sql`
				WITH deleted AS (
					DELETE FROM login_bonuses
					WHERE family_id = ${tenantId} AND child_id = ${childId} AND login_date < ${cutoffDate}
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM deleted
			`);
			return Number((result.rows[0] as { c: number }).c);
		},
	};
}
