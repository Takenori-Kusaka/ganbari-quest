// src/lib/server/db/tenant-event-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertTenantEventInput,
	TenantEvent,
	TenantEventProgress,
	UpdateTenantEventInput,
	UpsertTenantEventProgressInput,
} from './types';

export async function findByTenantAndYear(
	tenantId: string,
	year: number,
): Promise<TenantEvent[]> {
	return getRepos().tenantEvent.findByTenantAndYear(tenantId, year);
}

export async function findByEventCode(
	tenantId: string,
	eventCode: string,
	year: number,
): Promise<TenantEvent | undefined> {
	return getRepos().tenantEvent.findByEventCode(tenantId, eventCode, year);
}

export async function upsertEvent(
	input: InsertTenantEventInput,
	tenantId: string,
): Promise<TenantEvent> {
	return getRepos().tenantEvent.upsertEvent(input, tenantId);
}

export async function updateEvent(
	id: number,
	input: UpdateTenantEventInput,
	tenantId: string,
): Promise<void> {
	return getRepos().tenantEvent.updateEvent(id, input, tenantId);
}

export async function findProgress(
	tenantId: string,
	eventCode: string,
	childId: number,
	year: number,
): Promise<TenantEventProgress | undefined> {
	return getRepos().tenantEvent.findProgress(tenantId, eventCode, childId, year);
}

export async function findProgressByChild(
	childId: number,
	year: number,
	tenantId: string,
): Promise<TenantEventProgress[]> {
	return getRepos().tenantEvent.findProgressByChild(childId, year, tenantId);
}

export async function upsertProgress(
	input: UpsertTenantEventProgressInput,
	tenantId: string,
): Promise<void> {
	return getRepos().tenantEvent.upsertProgress(input, tenantId);
}
