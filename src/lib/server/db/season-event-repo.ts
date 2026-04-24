// src/lib/server/db/season-event-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	ChildEventProgress,
	InsertSeasonEventInput,
	SeasonEvent,
	UpdateSeasonEventInput,
} from './types';

export async function findAllEvents(tenantId: string): Promise<SeasonEvent[]> {
	return getRepos().seasonEvent.findAllEvents(tenantId);
}

export async function findActiveEvents(today: string, tenantId: string): Promise<SeasonEvent[]> {
	return getRepos().seasonEvent.findActiveEvents(today, tenantId);
}

export async function findEventById(
	id: number,
	tenantId: string,
): Promise<SeasonEvent | undefined> {
	return getRepos().seasonEvent.findEventById(id, tenantId);
}

export async function findEventByCode(
	code: string,
	tenantId: string,
): Promise<SeasonEvent | undefined> {
	return getRepos().seasonEvent.findEventByCode(code, tenantId);
}

export async function insertEvent(
	input: InsertSeasonEventInput,
	tenantId: string,
): Promise<SeasonEvent> {
	return getRepos().seasonEvent.insertEvent(input, tenantId);
}

export async function updateEvent(
	id: number,
	input: UpdateSeasonEventInput,
	tenantId: string,
): Promise<void> {
	return getRepos().seasonEvent.updateEvent(id, input, tenantId);
}

export async function deleteEvent(id: number, tenantId: string): Promise<void> {
	return getRepos().seasonEvent.deleteEvent(id, tenantId);
}

export async function findChildProgress(
	childId: number,
	eventId: number,
	tenantId: string,
): Promise<ChildEventProgress | undefined> {
	return getRepos().seasonEvent.findChildProgress(childId, eventId, tenantId);
}

async function _findChildActiveEvents(
	childId: number,
	today: string,
	tenantId: string,
): Promise<ChildEventProgress[]> {
	return getRepos().seasonEvent.findChildActiveEvents(childId, today, tenantId);
}

export async function upsertChildProgress(
	childId: number,
	eventId: number,
	status: string,
	progressJson: string | null,
	tenantId: string,
): Promise<void> {
	return getRepos().seasonEvent.upsertChildProgress(
		childId,
		eventId,
		status,
		progressJson,
		tenantId,
	);
}

export async function claimReward(
	childId: number,
	eventId: number,
	tenantId: string,
): Promise<void> {
	return getRepos().seasonEvent.claimReward(childId, eventId, tenantId);
}
