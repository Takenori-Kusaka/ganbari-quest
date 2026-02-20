// src/lib/server/db/login-bonus-repo.ts
// ログインボーナスのリポジトリ層

import { eq, and, desc } from 'drizzle-orm';
import { db } from './client';
import { loginBonuses, children } from './schema';

/** 今日のログインボーナスを取得 */
export function findTodayBonus(childId: number, today: string) {
	return db
		.select()
		.from(loginBonuses)
		.where(
			and(
				eq(loginBonuses.childId, childId),
				eq(loginBonuses.loginDate, today),
			),
		)
		.get();
}

/** 直近のログインボーナスを取得（連続日数計算用） */
export function findRecentBonuses(childId: number, limit: number = 60) {
	return db
		.select()
		.from(loginBonuses)
		.where(eq(loginBonuses.childId, childId))
		.orderBy(desc(loginBonuses.loginDate))
		.limit(limit)
		.all();
}

/** ログインボーナスを挿入 */
export function insertLoginBonus(input: {
	childId: number;
	loginDate: string;
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
}) {
	return db.insert(loginBonuses).values(input).returning().get();
}

/** 子供の存在確認 */
export function findChildById(id: number) {
	return db.select().from(children).where(eq(children.id, id)).get();
}
