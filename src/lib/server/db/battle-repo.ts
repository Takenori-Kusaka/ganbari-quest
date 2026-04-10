// src/lib/server/db/battle-repo.ts — Facade (delegates to factory)

import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import { getRepos } from './factory';

export async function findTodayBattle(childId: number, date: string, tenantId: string) {
	return getRepos().battle.findTodayBattle(childId, date, tenantId);
}

export async function findRecentBattles(childId: number, limit: number, tenantId: string) {
	return getRepos().battle.findRecentBattles(childId, limit, tenantId);
}

export async function countConsecutiveLosses(childId: number, tenantId: string) {
	return getRepos().battle.countConsecutiveLosses(childId, tenantId);
}

export async function insertDailyBattle(
	childId: number,
	enemyId: number,
	date: string,
	playerStats: BattleStats,
	tenantId: string,
) {
	return getRepos().battle.insertDailyBattle(childId, enemyId, date, playerStats, tenantId);
}

export async function completeBattle(
	battleId: number,
	outcome: BattleOutcome,
	rewardPoints: number,
	turnsUsed: number,
	tenantId: string,
) {
	return getRepos().battle.completeBattle(battleId, outcome, rewardPoints, turnsUsed, tenantId);
}

export async function findCollection(childId: number, tenantId: string) {
	return getRepos().battle.findCollection(childId, tenantId);
}

export async function upsertCollectionEntry(childId: number, enemyId: number, tenantId: string) {
	return getRepos().battle.upsertCollectionEntry(childId, enemyId, tenantId);
}
