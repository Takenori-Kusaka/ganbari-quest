// Demo IBattleRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import type { DailyBattleRow, EnemyCollectionRow } from '../interfaces/battle-repo.interface';

export async function findTodayBattle(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<DailyBattleRow | undefined> {
	return undefined;
}

export async function findRecentBattles(
	_childId: number,
	_limit: number,
	_tenantId: string,
): Promise<DailyBattleRow[]> {
	return [];
}

export async function countConsecutiveLosses(_childId: number, _tenantId: string): Promise<number> {
	return 0;
}

export async function insertDailyBattle(
	_childId: number,
	_enemyId: number,
	_date: string,
	_playerStats: BattleStats,
	_tenantId: string,
): Promise<number> {
	// Stub: return dummy battle id
	return 0;
}

export async function completeBattle(
	_battleId: number,
	_outcome: BattleOutcome,
	_rewardPoints: number,
	_turnsUsed: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function findCollection(
	_childId: number,
	_tenantId: string,
): Promise<EnemyCollectionRow[]> {
	return [];
}

export async function upsertCollectionEntry(
	_childId: number,
	_enemyId: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}
