// Demo ISeasonEventRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	ChildEventProgress,
	InsertSeasonEventInput,
	SeasonEvent,
	UpdateSeasonEventInput,
} from '../types';

export async function findAllEvents(_tenantId: string): Promise<SeasonEvent[]> {
	return [];
}

export async function findActiveEvents(_today: string, _tenantId: string): Promise<SeasonEvent[]> {
	return [];
}

export async function findEventById(
	_id: number,
	_tenantId: string,
): Promise<SeasonEvent | undefined> {
	return undefined;
}

export async function findEventByCode(
	_code: string,
	_tenantId: string,
): Promise<SeasonEvent | undefined> {
	return undefined;
}

export async function insertEvent(
	input: InsertSeasonEventInput,
	_tenantId: string,
): Promise<SeasonEvent> {
	const now = new Date().toISOString();
	return {
		id: 0,
		code: input.code,
		name: input.name,
		description: input.description ?? null,
		eventType: input.eventType ?? 'seasonal',
		startDate: input.startDate,
		endDate: input.endDate,
		bannerIcon: input.bannerIcon ?? '🎉',
		bannerColor: input.bannerColor ?? null,
		themeConfig: input.themeConfig ?? null,
		rewardConfig: input.rewardConfig ?? null,
		missionConfig: input.missionConfig ?? null,
		isActive: 1,
		createdAt: now,
		updatedAt: now,
	};
}

export async function updateEvent(
	_id: number,
	_input: UpdateSeasonEventInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteEvent(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function findChildProgress(
	_childId: number,
	_eventId: number,
	_tenantId: string,
): Promise<ChildEventProgress | undefined> {
	return undefined;
}

export async function findChildActiveEvents(
	_childId: number,
	_today: string,
	_tenantId: string,
): Promise<ChildEventProgress[]> {
	return [];
}

export async function upsertChildProgress(
	_childId: number,
	_eventId: number,
	_status: string,
	_progressJson: string | null,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function claimReward(
	_childId: number,
	_eventId: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
