// DynamoDB implementation of ISiblingCheerRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// きょうだいおうえん機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type { InsertSiblingCheerInput, SiblingCheer } from '../types';

const SERVICE = 'sibling-cheer-repo.dynamodb';

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

export async function insertCheer(
	input: InsertSiblingCheerInput,
	tenantId: string,
): Promise<SiblingCheer> {
	warnWrite('insertCheer', {
		fromChildId: input.fromChildId,
		toChildId: input.toChildId,
		tenantId,
	});
	return {
		id: 0,
		fromChildId: input.fromChildId,
		toChildId: input.toChildId,
		stampCode: input.stampCode,
		tenantId,
		sentAt: new Date().toISOString(),
		shownAt: null,
	};
}

export async function findUnshownCheers(
	toChildId: number,
	tenantId: string,
): Promise<SiblingCheer[]> {
	warnRead('findUnshownCheers', { toChildId, tenantId });
	return [];
}

export async function markShown(cheerIds: number[], tenantId: string): Promise<void> {
	warnWrite('markShown', { cheerIdsCount: cheerIds.length, tenantId });
}

export async function countTodayCheersFrom(fromChildId: number, tenantId: string): Promise<number> {
	warnRead('countTodayCheersFrom', { fromChildId, tenantId });
	return 0;
}

/** テナントの全おうえんスタンプを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
