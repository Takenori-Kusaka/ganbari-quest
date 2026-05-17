// Demo IBattleRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// #2097 Phase B-5b + battle fixture: 日次バトル fixture を返すことで
// /demo/lower/battle 等の RPG バトル画面が demo 環境でも稼働する。

import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import { DEMO_BATTLES } from '$lib/server/demo/demo-data';
import type { DailyBattleRow, EnemyCollectionRow } from '../interfaces/battle-repo.interface';

export async function findTodayBattle(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<DailyBattleRow | undefined> {
	return DEMO_BATTLES.find((b) => b.childId === childId && b.date === date);
}

export async function findRecentBattles(
	childId: number,
	limit: number,
	_tenantId: string,
): Promise<DailyBattleRow[]> {
	// 新しい順 (date DESC) で返す
	return DEMO_BATTLES.filter((b) => b.childId === childId)
		.slice()
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
		.slice(0, limit);
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
