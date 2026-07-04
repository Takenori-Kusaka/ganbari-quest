import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/battle-repo.ts — Facade (delegates to factory)

import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import { getRepos } from './factory';

export async function findTodayBattle(childId: ChildId, date: string, tenantId: string) {
	return getRepos().battle.findTodayBattle(childId, date, tenantId);
}

export async function findRecentBattles(childId: ChildId, limit: number, tenantId: string) {
	return getRepos().battle.findRecentBattles(childId, limit, tenantId);
}

export async function countConsecutiveLosses(childId: ChildId, tenantId: string) {
	return getRepos().battle.countConsecutiveLosses(childId, tenantId);
}

export async function insertDailyBattle(
	childId: ChildId,
	enemyId: number,
	date: string,
	playerStats: BattleStats,
	tenantId: string,
) {
	return getRepos().battle.insertDailyBattle(childId, enemyId, date, playerStats, tenantId);
}

export async function completeBattle(
	battleId: string,
	outcome: BattleOutcome,
	rewardPoints: number,
	turnsUsed: number,
	tenantId: string,
) {
	return getRepos().battle.completeBattle(battleId, outcome, rewardPoints, turnsUsed, tenantId);
}

export async function findCollection(childId: ChildId, tenantId: string) {
	return getRepos().battle.findCollection(childId, tenantId);
}

export async function upsertCollectionEntry(childId: ChildId, enemyId: number, tenantId: string) {
	return getRepos().battle.upsertCollectionEntry(childId, enemyId, tenantId);
}
