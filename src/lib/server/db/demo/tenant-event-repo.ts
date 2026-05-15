// Demo ITenantEventRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	InsertTenantEventInput,
	TenantEvent,
	TenantEventProgress,
	UpdateTenantEventInput,
	UpsertTenantEventProgressInput,
} from '../types';

export async function findByTenantAndYear(
	_tenantId: string,
	_year: number,
): Promise<TenantEvent[]> {
	return [];
}

export async function findByEventCode(
	_tenantId: string,
	_eventCode: string,
	_year: number,
): Promise<TenantEvent | undefined> {
	return undefined;
}

export async function upsertEvent(
	input: InsertTenantEventInput,
	tenantId: string,
): Promise<TenantEvent> {
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
	_id: number,
	_input: UpdateTenantEventInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function findProgress(
	_tenantId: string,
	_eventCode: string,
	_childId: number,
	_year: number,
): Promise<TenantEventProgress | undefined> {
	return undefined;
}

export async function findProgressByChild(
	_childId: number,
	_year: number,
	_tenantId: string,
): Promise<TenantEventProgress[]> {
	return [];
}

export async function upsertProgress(
	_input: UpsertTenantEventProgressInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
