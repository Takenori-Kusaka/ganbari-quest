// DynamoDB implementation of ITenantEventRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// テナントイベント機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type {
	InsertTenantEventInput,
	TenantEvent,
	TenantEventProgress,
	UpdateTenantEventInput,
	UpsertTenantEventProgressInput,
} from '../types';

const SERVICE = 'tenant-event-repo.dynamodb';

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

export async function findByTenantAndYear(tenantId: string, year: number): Promise<TenantEvent[]> {
	warnRead('findByTenantAndYear', { tenantId, year });
	return [];
}

export async function findByEventCode(
	tenantId: string,
	eventCode: string,
	year: number,
): Promise<TenantEvent | undefined> {
	warnRead('findByEventCode', { tenantId, eventCode, year });
	return undefined;
}

export async function upsertEvent(
	input: InsertTenantEventInput,
	tenantId: string,
): Promise<TenantEvent> {
	warnWrite('upsertEvent', { eventCode: input.eventCode, year: input.year, tenantId });
	const now = new Date().toISOString();
	return {
		id: 0,
		tenantId,
		eventCode: input.eventCode,
		year: input.year,
		enabled: input.enabled ?? 1,
		targetOverride: input.targetOverride ?? null,
		rewardMemo: input.rewardMemo ?? null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function updateEvent(
	id: number,
	_input: UpdateTenantEventInput,
	tenantId: string,
): Promise<void> {
	warnWrite('updateEvent', { id, tenantId });
}

export async function findProgress(
	tenantId: string,
	eventCode: string,
	childId: number,
	year: number,
): Promise<TenantEventProgress | undefined> {
	warnRead('findProgress', { tenantId, eventCode, childId, year });
	return undefined;
}

export async function findProgressByChild(
	childId: number,
	year: number,
	tenantId: string,
): Promise<TenantEventProgress[]> {
	warnRead('findProgressByChild', { childId, year, tenantId });
	return [];
}

export async function upsertProgress(
	input: UpsertTenantEventProgressInput,
	tenantId: string,
): Promise<void> {
	warnWrite('upsertProgress', {
		eventCode: input.eventCode,
		childId: input.childId,
		year: input.year,
		tenantId,
	});
}

/** テナントの全イベントデータを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
