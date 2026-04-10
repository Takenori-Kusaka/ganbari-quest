// src/lib/server/db/sqlite/battle-repo.ts
// バトルアドベンチャー SQLite リポジトリ

import { and, desc, eq, sql } from 'drizzle-orm';
import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import { db } from '../client';
import type { DailyBattleRow, EnemyCollectionRow } from '../interfaces/battle-repo.interface';
import { dailyBattles, enemyCollection } from '../schema';

/** 今日のバトルを取得 */
export async function findTodayBattle(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<DailyBattleRow | undefined> {
	return db
		.select()
		.from(dailyBattles)
		.where(and(eq(dailyBattles.childId, childId), eq(dailyBattles.date, date)))
		.get() as DailyBattleRow | undefined;
}

/** 直近のバトル履歴を取得 */
export async function findRecentBattles(
	childId: number,
	limit: number,
	_tenantId: string,
): Promise<DailyBattleRow[]> {
	return db
		.select()
		.from(dailyBattles)
		.where(eq(dailyBattles.childId, childId))
		.orderBy(desc(dailyBattles.date))
		.limit(limit)
		.all() as DailyBattleRow[];
}

/** 直近の連敗数をカウント */
export async function countConsecutiveLosses(childId: number, _tenantId: string): Promise<number> {
	const recent = await db
		.select({ outcome: dailyBattles.outcome })
		.from(dailyBattles)
		.where(and(eq(dailyBattles.childId, childId), eq(dailyBattles.status, 'completed')))
		.orderBy(desc(dailyBattles.date))
		.limit(5)
		.all();

	let losses = 0;
	for (const row of recent) {
		if (row.outcome === 'lose') {
			losses++;
		} else {
			break;
		}
	}
	return losses;
}

/** 日次バトルを登録 */
export async function insertDailyBattle(
	childId: number,
	enemyId: number,
	date: string,
	playerStats: BattleStats,
	_tenantId: string,
): Promise<number> {
	const result = db
		.insert(dailyBattles)
		.values({
			childId,
			enemyId,
			date,
			status: 'pending',
			playerStatsJson: JSON.stringify(playerStats),
		})
		.returning({ id: dailyBattles.id })
		.get();
	return result.id;
}

/** バトル結果を記録 */
export async function completeBattle(
	battleId: number,
	outcome: BattleOutcome,
	rewardPoints: number,
	turnsUsed: number,
	_tenantId: string,
): Promise<void> {
	db.update(dailyBattles)
		.set({
			status: 'completed',
			outcome,
			rewardPoints,
			turnsUsed,
			updatedAt: sql`CURRENT_TIMESTAMP`,
		})
		.where(eq(dailyBattles.id, battleId))
		.run();
}

/** 敵図鑑を取得 */
export async function findCollection(
	childId: number,
	_tenantId: string,
): Promise<EnemyCollectionRow[]> {
	return db
		.select()
		.from(enemyCollection)
		.where(eq(enemyCollection.childId, childId))
		.all() as EnemyCollectionRow[];
}

/** 敵図鑑エントリを追加/更新 */
export async function upsertCollectionEntry(
	childId: number,
	enemyId: number,
	_tenantId: string,
): Promise<void> {
	const existing = db
		.select()
		.from(enemyCollection)
		.where(and(eq(enemyCollection.childId, childId), eq(enemyCollection.enemyId, enemyId)))
		.get();

	if (existing) {
		db.update(enemyCollection)
			.set({ defeatCount: sql`defeat_count + 1` })
			.where(and(eq(enemyCollection.childId, childId), eq(enemyCollection.enemyId, enemyId)))
			.run();
	} else {
		db.insert(enemyCollection)
			.values({
				childId,
				enemyId,
			})
			.run();
	}
}
