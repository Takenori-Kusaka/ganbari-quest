// src/lib/server/db/login-bonus-repo.ts
// ログインボーナスのリポジトリ層

import { and, desc, eq, lt } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import { children, loginBonuses } from '../schema';
import type { Child, InsertLoginBonusInput, LoginBonus } from '../types';

type LoginBonusRow = typeof loginBonuses.$inferSelect;

const toLoginBonus = (r: LoginBonusRow): LoginBonus => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

/** 今日のログインボーナスを取得 */
export async function findTodayBonus(
	childId: ChildId,
	today: string,
	_tenantId: string,
): Promise<LoginBonus | undefined> {
	const row = db
		.select()
		.from(loginBonuses)
		.where(and(eq(loginBonuses.childId, Number(childId)), eq(loginBonuses.loginDate, today)))
		.get();
	return row ? toLoginBonus(row) : undefined;
}

/** 直近のログインボーナスを取得（連続日数計算用） */
export async function findRecentBonuses(
	childId: ChildId,
	_tenantId: string,
	limit = 60,
): Promise<LoginBonus[]> {
	return db
		.select()
		.from(loginBonuses)
		.where(eq(loginBonuses.childId, Number(childId)))
		.orderBy(desc(loginBonuses.loginDate))
		.limit(limit)
		.all()
		.map(toLoginBonus);
}

/** ログインボーナスを挿入（同日重複時は無視） */
export async function insertLoginBonus(
	input: InsertLoginBonusInput,
	_tenantId: string,
): Promise<LoginBonus> {
	return toLoginBonus(
		db
			.insert(loginBonuses)
			.values({ ...input, childId: Number(input.childId) })
			.onConflictDoNothing()
			.returning()
			.get(),
	);
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

/** テナントの全ログインボーナスを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(loginBonuses).run();
}

/**
 * 指定した子供の `login_date < cutoffDate` に該当する login_bonuses を削除する。
 * cutoffDate は `YYYY-MM-DD` 形式で、その日自体は削除対象に含まない（strict less than）。
 * #717, #729
 */
export async function deleteLoginBonusesBeforeDate(
	childId: ChildId,
	cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	const result = db
		.delete(loginBonuses)
		.where(and(eq(loginBonuses.childId, Number(childId)), lt(loginBonuses.loginDate, cutoffDate)))
		.run();
	return result.changes;
}
