// DynamoDB implementation of ISeasonEventRepo (stub)

import type {
	ChildEventProgress,
	InsertSeasonEventInput,
	SeasonEvent,
	UpdateSeasonEventInput,
} from '../types';

const NOT_IMPL = 'season-event-repo: DynamoDB not implemented';

export async function findAllEvents(_tenantId: string): Promise<SeasonEvent[]> {
	throw new Error(NOT_IMPL);
}

export async function findActiveEvents(_today: string, _tenantId: string): Promise<SeasonEvent[]> {
	throw new Error(NOT_IMPL);
}

export async function findEventById(
	_id: number,
	_tenantId: string,
): Promise<SeasonEvent | undefined> {
	throw new Error(NOT_IMPL);
}

export async function findEventByCode(
	_code: string,
	_tenantId: string,
): Promise<SeasonEvent | undefined> {
	throw new Error(NOT_IMPL);
}

export async function insertEvent(
	_input: InsertSeasonEventInput,
	_tenantId: string,
): Promise<SeasonEvent> {
	throw new Error(NOT_IMPL);
}

export async function updateEvent(
	_id: number,
	_input: UpdateSeasonEventInput,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function deleteEvent(_id: number, _tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function findChildProgress(
	_childId: number,
	_eventId: number,
	_tenantId: string,
): Promise<ChildEventProgress | undefined> {
	throw new Error(NOT_IMPL);
}

export async function findChildActiveEvents(
	_childId: number,
	_today: string,
	_tenantId: string,
): Promise<ChildEventProgress[]> {
	throw new Error(NOT_IMPL);
}

export async function upsertChildProgress(
	_childId: number,
	_eventId: number,
	_status: string,
	_progressJson: string | null,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function claimReward(
	_childId: number,
	_eventId: number,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}
