// src/lib/server/db/sqlite/battle-repo.ts
// バトルアドベンチャー SQLite リポジトリ

import { and, desc, eq, sql } from 'drizzle-orm';
import { BATTLE_LEDGER_TYPE, type BattleOutcome, type BattleStats } from '$lib/domain/battle-types';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import type { DailyBattleRow, EnemyCollectionRow } from '../interfaces/battle-repo.interface';
import { dailyBattles, enemyCollection, pointLedger } from '../schema';

type BattleRow = typeof dailyBattles.$inferSelect;
type CollectionRow = typeof enemyCollection.$inferSelect;

const toBattleRow = (r: BattleRow): DailyBattleRow => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	status: r.status as DailyBattleRow['status'],
	outcome: r.outcome as DailyBattleRow['outcome'],
});

const toCollectionRow = (r: CollectionRow): EnemyCollectionRow => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

/** 今日のバトルを取得 */
export async function findTodayBattle(
	childId: ChildId,
	date: string,
	_tenantId: string,
): Promise<DailyBattleRow | undefined> {
	const row = db
		.select()
		.from(dailyBattles)
		.where(and(eq(dailyBattles.childId, Number(childId)), eq(dailyBattles.date, date)))
		.get();
	return row ? toBattleRow(row) : undefined;
}

/** 直近のバトル履歴を取得 */
export async function findRecentBattles(
	childId: ChildId,
	limit: number,
	_tenantId: string,
): Promise<DailyBattleRow[]> {
	return db
		.select()
		.from(dailyBattles)
		.where(eq(dailyBattles.childId, Number(childId)))
		.orderBy(desc(dailyBattles.date))
		.limit(limit)
		.all()
		.map(toBattleRow);
}

/** 直近の連敗数をカウント */
export async function countConsecutiveLosses(childId: ChildId, _tenantId: string): Promise<number> {
	const recent = await db
		.select({ outcome: dailyBattles.outcome })
		.from(dailyBattles)
		.where(and(eq(dailyBattles.childId, Number(childId)), eq(dailyBattles.status, 'completed')))
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
	childId: ChildId,
	enemyId: number,
	date: string,
	playerStats: BattleStats,
	_tenantId: string,
): Promise<string> {
	const result = db
		.insert(dailyBattles)
		.values({
			childId: Number(childId),
			enemyId,
			date,
			status: 'pending',
			playerStatsJson: JSON.stringify(playerStats),
		})
		.returning({ id: dailyBattles.id })
		.get();
	return String(result.id);
}

/** バトル結果を記録 */
export async function completeBattle(
	battleId: string,
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
		.where(eq(dailyBattles.id, Number(battleId)))
		.run();
}

/**
 * #4681: 完了 flip + 報酬 ledger を単一 txn で実行する原子 primitive。
 * status='pending' の行だけ flip し、成立時のみ ledger を INSERT する (両成功 or 両 rollback)。
 */
export async function completeBattleAndGrantPoints(
	battleId: string,
	outcome: BattleOutcome,
	rewardPoints: number,
	turnsUsed: number,
	ledger: { childId: ChildId; amount: number; description: string },
	_tenantId: string,
): Promise<number> {
	return db.transaction((tx) => {
		const result = tx
			.update(dailyBattles)
			.set({
				status: 'completed',
				outcome,
				rewardPoints,
				turnsUsed,
				updatedAt: sql`CURRENT_TIMESTAMP`,
			})
			.where(and(eq(dailyBattles.id, Number(battleId)), eq(dailyBattles.status, 'pending')))
			.run();
		if (result.changes !== 1) return 0;
		if (ledger.amount !== 0) {
			tx.insert(pointLedger)
				.values({
					childId: Number(ledger.childId),
					amount: ledger.amount,
					type: BATTLE_LEDGER_TYPE,
					description: ledger.description,
					referenceId: Number(battleId),
				})
				.run();
		}
		return 1;
	});
}

/** 敵図鑑を取得 */
export async function findCollection(
	childId: ChildId,
	_tenantId: string,
): Promise<EnemyCollectionRow[]> {
	return db
		.select()
		.from(enemyCollection)
		.where(eq(enemyCollection.childId, Number(childId)))
		.all()
		.map(toCollectionRow);
}

/** 敵図鑑エントリを追加/更新 */
export async function upsertCollectionEntry(
	childId: ChildId,
	enemyId: number,
	_tenantId: string,
): Promise<void> {
	const existing = db
		.select()
		.from(enemyCollection)
		.where(and(eq(enemyCollection.childId, Number(childId)), eq(enemyCollection.enemyId, enemyId)))
		.get();

	if (existing) {
		db.update(enemyCollection)
			.set({ defeatCount: sql`defeat_count + 1` })
			.where(
				and(eq(enemyCollection.childId, Number(childId)), eq(enemyCollection.enemyId, enemyId)),
			)
			.run();
	} else {
		db.insert(enemyCollection)
			.values({
				childId: Number(childId),
				enemyId,
			})
			.run();
	}
}
