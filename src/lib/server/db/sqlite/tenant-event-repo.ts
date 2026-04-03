// SQLite implementation of ITenantEventRepo

import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { tenantEventProgress, tenantEvents } from '../schema';
import type {
	InsertTenantEventInput,
	TenantEvent,
	TenantEventProgress,
	UpdateTenantEventInput,
	UpsertTenantEventProgressInput,
} from '../types';

export async function findByTenantAndYear(
	tenantId: string,
	year: number,
): Promise<TenantEvent[]> {
	return db
		.select()
		.from(tenantEvents)
		.where(and(eq(tenantEvents.tenantId, tenantId), eq(tenantEvents.year, year)))
		.all() as TenantEvent[];
}

export async function findByEventCode(
	tenantId: string,
	eventCode: string,
	year: number,
): Promise<TenantEvent | undefined> {
	return db
		.select()
		.from(tenantEvents)
		.where(
			and(
				eq(tenantEvents.tenantId, tenantId),
				eq(tenantEvents.eventCode, eventCode),
				eq(tenantEvents.year, year),
			),
		)
		.get() as TenantEvent | undefined;
}

export async function upsertEvent(
	input: InsertTenantEventInput,
	tenantId: string,
): Promise<TenantEvent> {
	const now = new Date().toISOString();
	const result = db
		.insert(tenantEvents)
		.values({
			tenantId,
			eventCode: input.eventCode,
			year: input.year,
			enabled: input.enabled ?? 1,
			targetOverride: input.targetOverride ?? null,
			rewardMemo: input.rewardMemo ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [tenantEvents.tenantId, tenantEvents.eventCode, tenantEvents.year],
			set: {
				enabled: input.enabled ?? 1,
				targetOverride: input.targetOverride ?? null,
				rewardMemo: input.rewardMemo ?? null,
				updatedAt: now,
			},
		})
		.returning()
		.get();
	return result as TenantEvent;
}

export async function updateEvent(
	id: number,
	input: UpdateTenantEventInput,
	_tenantId: string,
): Promise<void> {
	db.update(tenantEvents)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(tenantEvents.id, id))
		.run();
}

export async function findProgress(
	tenantId: string,
	eventCode: string,
	childId: number,
	year: number,
): Promise<TenantEventProgress | undefined> {
	return db
		.select()
		.from(tenantEventProgress)
		.where(
			and(
				eq(tenantEventProgress.tenantId, tenantId),
				eq(tenantEventProgress.eventCode, eventCode),
				eq(tenantEventProgress.childId, childId),
				eq(tenantEventProgress.year, year),
			),
		)
		.get() as TenantEventProgress | undefined;
}

export async function findProgressByChild(
	childId: number,
	year: number,
	tenantId: string,
): Promise<TenantEventProgress[]> {
	return db
		.select()
		.from(tenantEventProgress)
		.where(
			and(
				eq(tenantEventProgress.tenantId, tenantId),
				eq(tenantEventProgress.childId, childId),
				eq(tenantEventProgress.year, year),
			),
		)
		.all() as TenantEventProgress[];
}

export async function upsertProgress(
	input: UpsertTenantEventProgressInput,
	tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.insert(tenantEventProgress)
		.values({
			tenantId,
			eventCode: input.eventCode,
			childId: input.childId,
			year: input.year,
			currentCount: input.currentCount,
			completedAt: input.completedAt ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				tenantEventProgress.tenantId,
				tenantEventProgress.eventCode,
				tenantEventProgress.childId,
				tenantEventProgress.year,
			],
			set: {
				currentCount: input.currentCount,
				completedAt: input.completedAt ?? null,
				updatedAt: now,
			},
		})
		.run();
}
