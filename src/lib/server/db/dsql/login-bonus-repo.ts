// src/lib/server/db/dsql/login-bonus-repo.ts
// EPIC #3424 / #3330 案 B counter 縮約 / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ILoginBonusRepo (counter 状態) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全メソッドが単文のため TransactionRunner は不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **child-level 自然 PK (family_id, child_id)**: 子供ごとに counter 1 行 (構造的確実性)。
//   - **当日冪等 (1日1回 = ADR-0012)**: 旧 per-date PK 衝突方式に代わり、claimToday の
//     単一 INSERT ... ON CONFLICT DO UPDATE ... WHERE last_login_date <> excluded.last_login_date
//     (conditional write) が原子的に担保する。increment/reset は SQL 内 CASE で行い
//     read-then-write の race 窓を作らない (race 回帰: dsql-login-streak-repo.test.ts)。
//   - findChildById は child-repo の CHILD_COLUMNS / toChild を共有 (mapping 二重実装禁止)。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import type { ILoginBonusRepo } from '../interfaces/login-bonus-repo.interface';
import type { LoginStreak, UpsertLoginStreakInput } from '../types';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface LoginStreakRow {
	child_id: string;
	last_login_date: string;
	current_streak: number;
	updated_at: string;
}

const LOGIN_STREAK_COLUMNS = sql.raw(`child_id, last_login_date, current_streak, updated_at`);

function toLoginStreak(row: LoginStreakRow): LoginStreak {
	return {
		childId: asChildId(row.child_id),
		lastLoginDate: row.last_login_date,
		currentStreak: row.current_streak,
		updatedAt: row.updated_at,
	};
}

/** DSQL 用 ILoginBonusRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlLoginBonusRepo(db: SqlExecutor): ILoginBonusRepo {
	return {
		async findStreak(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${LOGIN_STREAK_COLUMNS} FROM login_streaks
				WHERE family_id = ${tenantId} AND child_id = ${childId}
			`);
			const row = result.rows[0] as unknown as LoginStreakRow | undefined;
			return row ? toLoginStreak(row) : undefined;
		},

		async claimToday(childId, today, yesterday, tenantId) {
			// conditional write: 当日 claim 済 (last_login_date = today) は WHERE で弾かれ 0 行。
			const result = await db.execute(sql`
				INSERT INTO login_streaks (family_id, child_id, last_login_date, current_streak)
				VALUES (${tenantId}, ${childId}, ${today}, 1)
				ON CONFLICT (family_id, child_id) DO UPDATE SET
					current_streak = CASE
						WHEN login_streaks.last_login_date = ${yesterday} THEN login_streaks.current_streak + 1
						ELSE 1
					END,
					last_login_date = excluded.last_login_date,
					updated_at = now()
				WHERE login_streaks.last_login_date <> excluded.last_login_date
				RETURNING current_streak
			`);
			const row = result.rows[0] as unknown as { current_streak: number } | undefined;
			return row ? { currentStreak: Number(row.current_streak) } : undefined;
		},

		async upsertStreak(input: UpsertLoginStreakInput, tenantId) {
			// migration / backup import 専用: lastLoginDate が新しい方 (同日なら streak 大) を残す。
			const updatedAt = input.updatedAt ?? new Date().toISOString();
			const result = await db.execute(sql`
				INSERT INTO login_streaks (family_id, child_id, last_login_date, current_streak, updated_at)
				VALUES (${tenantId}, ${input.childId}, ${input.lastLoginDate}, ${input.currentStreak}, ${updatedAt})
				ON CONFLICT (family_id, child_id) DO UPDATE SET
					last_login_date = excluded.last_login_date,
					current_streak = excluded.current_streak,
					updated_at = excluded.updated_at
				WHERE excluded.last_login_date > login_streaks.last_login_date
					OR (excluded.last_login_date = login_streaks.last_login_date
						AND excluded.current_streak > login_streaks.current_streak)
				RETURNING child_id
			`);
			return result.rows.length > 0;
		},

		async findChildById(id, tenantId) {
			// #3709: 非 uuid の stale id は 22P02 throw ではなく not-found に正規化 (pg-uuid.ts 参照)。
			// #3581 ②: guard trip を rate-limited に warn (systematic id バグの observability)。
			if (!isUuidFormat(id)) {
				warnInvalidUuidId('login-bonus-repo.findChildById');
				return undefined;
			}
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children
				WHERE family_id = ${tenantId} AND child_id = ${id}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM login_streaks WHERE family_id = ${tenantId}`);
		},
	};
}
