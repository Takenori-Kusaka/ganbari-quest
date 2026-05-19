// src/lib/server/db/dynamodb/stamp-card-repo.ts
// DynamoDB implementation of IStampCardRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// スタンプカード機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';

const SERVICE = 'stamp-card-repo.dynamodb';

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

export async function findEnabledStampMasters(tenantId: string): Promise<StampMaster[]> {
	warnRead('findEnabledStampMasters', { tenantId });
	return [];
}

export async function findCardByChildAndWeek(
	childId: number,
	weekStart: string,
	tenantId: string,
): Promise<StampCard | undefined> {
	warnRead('findCardByChildAndWeek', { childId, weekStart, tenantId });
	return undefined;
}

export async function insertCard(
	input: InsertStampCardInput,
	tenantId: string,
): Promise<StampCard> {
	warnWrite('insertCard', { childId: input.childId, weekStart: input.weekStart, tenantId });
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		weekStart: input.weekStart,
		weekEnd: input.weekEnd,
		status: input.status ?? 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function findEntriesWithMasterByCardId(
	cardId: number,
	tenantId: string,
): Promise<StampEntryWithMaster[]> {
	warnRead('findEntriesWithMasterByCardId', { cardId, tenantId });
	return [];
}

export async function insertEntry(input: InsertStampEntryInput, tenantId: string): Promise<void> {
	warnWrite('insertEntry', { cardId: input.cardId, slot: input.slot, tenantId });
}

export async function updateCardStatus(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
): Promise<void> {
	warnWrite('updateCardStatus', { cardId, status: input.status, tenantId });
}

export async function updateCardStatusIfCollecting(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
): Promise<number> {
	warnWrite('updateCardStatusIfCollecting', { cardId, status: input.status, tenantId });
	return 0;
}

/** テナントの全スタンプカード・エントリを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
