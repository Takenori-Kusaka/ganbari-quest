// src/lib/server/db/sqlite/login-bonus-repo.ts
// ログインボーナス counter (#3330 案 B counter 縮約) の SQLite 実装。
//
// 当日冪等 (1日1回 = ADR-0012) は単一 INSERT ... ON CONFLICT DO UPDATE ... WHERE の
// conditional write が原子的に担保する (旧 per-date PK 衝突方式を置換、Duolingo 型)。

import { eq, sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import { children, loginStreaks } from '../schema';
import type { Child, LoginStreak, UpsertLoginStreakInput } from '../types';

type LoginStreakRow = typeof loginStreaks.$inferSelect;

const toLoginStreak = (r: LoginStreakRow): LoginStreak => ({
	childId: asChildId(r.childId),
	lastLoginDate: r.lastLoginDate,
	currentStreak: r.currentStreak,
	updatedAt: r.updatedAt,
});

/** 子供の counter 状態を取得 */
export async function findStreak(
	childId: ChildId,
	_tenantId: string,
): Promise<LoginStreak | undefined> {
	const row = db
		.select()
		.from(loginStreaks)
		.where(eq(loginStreaks.childId, Number(childId)))
		.get();
	return row ? toLoginStreak(row) : undefined;
}

/**
 * 当日 claim (conditional write)。当日 claim 済なら書き込まず undefined。
 * increment/reset の判定は SQL 内 CASE で行い read-then-write の race 窓を作らない。
 */
export async function claimToday(
	childId: ChildId,
	today: string,
	yesterday: string,
	_tenantId: string,
): Promise<{ currentStreak: number } | undefined> {
	const rows = db.all<{ current_streak: number }>(sql`
		INSERT INTO login_streaks (child_id, last_login_date, current_streak)
		VALUES (${Number(childId)}, ${today}, 1)
		ON CONFLICT (child_id) DO UPDATE SET
			current_streak = CASE
				WHEN login_streaks.last_login_date = ${yesterday} THEN login_streaks.current_streak + 1
				ELSE 1
			END,
			last_login_date = excluded.last_login_date,
			updated_at = CURRENT_TIMESTAMP
		WHERE login_streaks.last_login_date <> excluded.last_login_date
		RETURNING current_streak
	`);
	const row = rows[0];
	return row ? { currentStreak: Number(row.current_streak) } : undefined;
}

/**
 * counter の直接 upsert (migration / backup import 専用)。
 * 既存行がある場合は lastLoginDate が新しい方 (同日なら currentStreak が大きい方) を残す。
 */
export async function upsertStreak(
	input: UpsertLoginStreakInput,
	_tenantId: string,
): Promise<boolean> {
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	const rows = db.all<{ id: number }>(sql`
		INSERT INTO login_streaks (child_id, last_login_date, current_streak, updated_at)
		VALUES (${Number(input.childId)}, ${input.lastLoginDate}, ${input.currentStreak}, ${updatedAt})
		ON CONFLICT (child_id) DO UPDATE SET
			last_login_date = excluded.last_login_date,
			current_streak = excluded.current_streak,
			updated_at = excluded.updated_at
		WHERE excluded.last_login_date > login_streaks.last_login_date
			OR (excluded.last_login_date = login_streaks.last_login_date
				AND excluded.current_streak > login_streaks.current_streak)
		RETURNING id
	`);
	return rows.length > 0;
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

/** テナントの全 counter を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(loginStreaks).run();
}
