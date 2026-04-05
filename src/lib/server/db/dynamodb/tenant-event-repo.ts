// DynamoDB implementation of ITenantEventRepo (stub)

import type {
	InsertTenantEventInput,
	TenantEvent,
	TenantEventProgress,
	UpdateTenantEventInput,
	UpsertTenantEventProgressInput,
} from '../types';

const NOT_IMPL = 'tenant-event-repo: DynamoDB not implemented';

export async function findByTenantAndYear(
	_tenantId: string,
	_year: number,
): Promise<TenantEvent[]> {
	throw new Error(NOT_IMPL);
}

export async function findByEventCode(
	_tenantId: string,
	_eventCode: string,
	_year: number,
): Promise<TenantEvent | undefined> {
	throw new Error(NOT_IMPL);
}

export async function upsertEvent(
	_input: InsertTenantEventInput,
	_tenantId: string,
): Promise<TenantEvent> {
	throw new Error(NOT_IMPL);
}

export async function updateEvent(
	_id: number,
	_input: UpdateTenantEventInput,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function findProgress(
	_tenantId: string,
	_eventCode: string,
	_childId: number,
	_year: number,
): Promise<TenantEventProgress | undefined> {
	throw new Error(NOT_IMPL);
}

export async function findProgressByChild(
	_childId: number,
	_year: number,
	_tenantId: string,
): Promise<TenantEventProgress[]> {
	throw new Error(NOT_IMPL);
}

export async function upsertProgress(
	_input: UpsertTenantEventProgressInput,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

/** テナントの全イベントデータを削除（DynamoDB未実装: 書き込みがないため no-op） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// DynamoDB tenant-event repo は未実装のため書き込みデータなし — no-op
}
