import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import type { ChildId } from '$lib/domain/ids';

export interface DailyBattleRow {
	id: string;
	childId: ChildId;
	enemyId: number;
	date: string;
	status: 'pending' | 'completed';
	outcome: BattleOutcome | null;
	rewardPoints: number;
	turnsUsed: number;
	playerStatsJson: string;
	createdAt: string;
	updatedAt: string;
}

export interface EnemyCollectionRow {
	id: string;
	childId: ChildId;
	enemyId: number;
	firstDefeatedAt: string;
	defeatCount: number;
}

export interface IBattleRepo {
	findTodayBattle(
		childId: ChildId,
		date: string,
		tenantId: string,
	): Promise<DailyBattleRow | undefined>;

	findRecentBattles(childId: ChildId, limit: number, tenantId: string): Promise<DailyBattleRow[]>;

	countConsecutiveLosses(childId: ChildId, tenantId: string): Promise<number>;

	insertDailyBattle(
		childId: ChildId,
		enemyId: number,
		date: string,
		playerStats: BattleStats,
		tenantId: string,
	): Promise<string>;

	completeBattle(
		battleId: string,
		outcome: BattleOutcome,
		rewardPoints: number,
		turnsUsed: number,
		tenantId: string,
	): Promise<void>;

	findCollection(childId: ChildId, tenantId: string): Promise<EnemyCollectionRow[]>;

	upsertCollectionEntry(childId: ChildId, enemyId: number, tenantId: string): Promise<void>;
}
