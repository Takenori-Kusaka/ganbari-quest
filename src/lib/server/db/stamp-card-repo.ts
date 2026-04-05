// src/lib/server/db/stamp-card-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	UpdateStampCardStatusInput,
} from './types';

export async function findEnabledStampMasters(tenantId: string) {
	return getRepos().stampCard.findEnabledStampMasters(tenantId);
}

export async function findCardByChildAndWeek(childId: number, weekStart: string, tenantId: string) {
	return getRepos().stampCard.findCardByChildAndWeek(childId, weekStart, tenantId);
}

export async function insertCard(input: InsertStampCardInput, tenantId: string) {
	return getRepos().stampCard.insertCard(input, tenantId);
}

export async function findEntriesWithMasterByCardId(cardId: number, tenantId: string) {
	return getRepos().stampCard.findEntriesWithMasterByCardId(cardId, tenantId);
}

export async function insertEntry(input: InsertStampEntryInput, tenantId: string) {
	return getRepos().stampCard.insertEntry(input, tenantId);
}

export async function updateCardStatus(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
) {
	return getRepos().stampCard.updateCardStatus(cardId, input, tenantId);
}

export async function updateCardStatusIfCollecting(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
) {
	return getRepos().stampCard.updateCardStatusIfCollecting(cardId, input, tenantId);
}
