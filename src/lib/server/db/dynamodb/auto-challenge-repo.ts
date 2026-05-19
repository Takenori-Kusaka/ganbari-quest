// DynamoDB implementation of IAutoChallengeRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// 自動チャレンジ機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

const SERVICE = 'auto-challenge-repo.dynamodb';

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

export async function findByChildAndWeek(
	childId: number,
	weekStart: string,
	tenantId: string,
): Promise<AutoChallenge | undefined> {
	warnRead('findByChildAndWeek', { childId, weekStart, tenantId });
	return undefined;
}

export async function findActiveByChild(
	childId: number,
	tenantId: string,
): Promise<AutoChallenge | undefined> {
	warnRead('findActiveByChild', { childId, tenantId });
	return undefined;
}

export async function findByChild(
	childId: number,
	tenantId: string,
	limit?: number,
): Promise<AutoChallenge[]> {
	warnRead('findByChild', { childId, tenantId, limit });
	return [];
}

export async function insert(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	warnWrite('insert', { childId: input.childId, tenantId });
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		tenantId,
		weekStart: input.weekStart,
		categoryId: input.categoryId,
		targetCount: input.targetCount,
		currentCount: 0,
		status: 'active',
		createdAt: now,
		updatedAt: now,
	};
}

export async function update(
	id: number,
	_input: UpdateAutoChallengeInput,
	tenantId: string,
): Promise<void> {
	warnWrite('update', { id, tenantId });
}

export async function expireOldChallenges(beforeDate: string, tenantId: string): Promise<number> {
	warnWrite('expireOldChallenges', { beforeDate, tenantId });
	return 0;
}

/** テナントの全自動チャレンジを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
