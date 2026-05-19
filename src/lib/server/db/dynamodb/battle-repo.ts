// src/lib/server/db/dynamodb/battle-repo.ts
// DynamoDB implementation of IBattleRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// バトル機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import { logger } from '$lib/server/logger';
import type { DailyBattleRow, EnemyCollectionRow } from '../interfaces/battle-repo.interface';

const SERVICE = 'battle-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export async function findTodayBattle(
	childId: number,
	date: string,
	tenantId: string,
): Promise<DailyBattleRow | undefined> {
	warnRead('findTodayBattle', { childId, date, tenantId });
	return undefined;
}

export async function findRecentBattles(
	childId: number,
	limit: number,
	tenantId: string,
): Promise<DailyBattleRow[]> {
	warnRead('findRecentBattles', { childId, limit, tenantId });
	return [];
}

export async function countConsecutiveLosses(childId: number, tenantId: string): Promise<number> {
	warnRead('countConsecutiveLosses', { childId, tenantId });
	return 0;
}

export async function insertDailyBattle(
	childId: number,
	enemyId: number,
	date: string,
	_playerStats: BattleStats,
	tenantId: string,
): Promise<number> {
	warnWrite('insertDailyBattle', { childId, enemyId, date, tenantId });
	return 0;
}

export async function completeBattle(
	battleId: number,
	outcome: BattleOutcome,
	rewardPoints: number,
	turnsUsed: number,
	tenantId: string,
): Promise<void> {
	warnWrite('completeBattle', { battleId, outcome, rewardPoints, turnsUsed, tenantId });
}

export async function findCollection(
	childId: number,
	tenantId: string,
): Promise<EnemyCollectionRow[]> {
	warnRead('findCollection', { childId, tenantId });
	return [];
}

export async function upsertCollectionEntry(
	childId: number,
	enemyId: number,
	tenantId: string,
): Promise<void> {
	warnWrite('upsertCollectionEntry', { childId, enemyId, tenantId });
}
