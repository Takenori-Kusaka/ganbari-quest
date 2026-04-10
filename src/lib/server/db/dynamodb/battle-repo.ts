// src/lib/server/db/dynamodb/battle-repo.ts
// DynamoDB implementation of IBattleRepo (stub)

import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import type { DailyBattleRow, EnemyCollectionRow } from '../interfaces/battle-repo.interface';

const NOT_IMPL = 'DynamoDB battle-repo not implemented';

export async function findTodayBattle(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<DailyBattleRow | undefined> {
	throw new Error(NOT_IMPL);
}

export async function findRecentBattles(
	_childId: number,
	_limit: number,
	_tenantId: string,
): Promise<DailyBattleRow[]> {
	throw new Error(NOT_IMPL);
}

export async function countConsecutiveLosses(_childId: number, _tenantId: string): Promise<number> {
	throw new Error(NOT_IMPL);
}

export async function insertDailyBattle(
	_childId: number,
	_enemyId: number,
	_date: string,
	_playerStats: BattleStats,
	_tenantId: string,
): Promise<number> {
	throw new Error(NOT_IMPL);
}

export async function completeBattle(
	_battleId: number,
	_outcome: BattleOutcome,
	_rewardPoints: number,
	_turnsUsed: number,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function findCollection(
	_childId: number,
	_tenantId: string,
): Promise<EnemyCollectionRow[]> {
	throw new Error(NOT_IMPL);
}

export async function upsertCollectionEntry(
	_childId: number,
	_enemyId: number,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}
