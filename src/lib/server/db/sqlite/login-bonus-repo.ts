// src/lib/server/db/login-bonus-repo.ts
// ログインボーナスのリポジトリ層

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { children, loginBonuses } from '../schema';

/** 今日のログインボーナスを取得 */
export async function findTodayBonus(childId: number, today: string, _tenantId: string) {
	return db
		.select()
		.from(loginBonuses)
		.where(and(eq(loginBonuses.childId, childId), eq(loginBonuses.loginDate, today)))
		.get();
}

/** 直近のログインボーナスを取得（連続日数計算用） */
export async function findRecentBonuses(childId: number, _tenantId: string, limit = 60) {
	return db
		.select()
		.from(loginBonuses)
		.where(eq(loginBonuses.childId, childId))
		.orderBy(desc(loginBonuses.loginDate))
		.limit(limit)
		.all();
}

/** ログインボーナスを挿入（同日重複時は無視） */
export async function insertLoginBonus(
	input: {
		childId: number;
		loginDate: string;
		rank: string;
		basePoints: number;
		multiplier: number;
		totalPoints: number;
		consecutiveDays: number;
	},
	_tenantId: string,
) {
	return db
		.insert(loginBonuses)
		.values(input)
		.onConflictDoNothing()
		.returning()
		.get();
}

/** 子供の存在確認 */
export async function findChildById(id: number, _tenantId: string) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

/** テナントの全ログインボーナスを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(loginBonuses).run();
}
