import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';

export interface DailyBattleRow {
	id: number;
	childId: number;
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
	id: number;
	childId: number;
	enemyId: number;
	firstDefeatedAt: string;
	defeatCount: number;
}

export interface IBattleRepo {
	findTodayBattle(
		childId: number,
		date: string,
		tenantId: string,
	): Promise<DailyBattleRow | undefined>;

	findRecentBattles(childId: number, limit: number, tenantId: string): Promise<DailyBattleRow[]>;

	countConsecutiveLosses(childId: number, tenantId: string): Promise<number>;

	insertDailyBattle(
		childId: number,
		enemyId: number,
		date: string,
		playerStats: BattleStats,
		tenantId: string,
	): Promise<number>;

	completeBattle(
		battleId: number,
		outcome: BattleOutcome,
		rewardPoints: number,
		turnsUsed: number,
		tenantId: string,
	): Promise<void>;

	findCollection(childId: number, tenantId: string): Promise<EnemyCollectionRow[]>;

	upsertCollectionEntry(childId: number, enemyId: number, tenantId: string): Promise<void>;
}
