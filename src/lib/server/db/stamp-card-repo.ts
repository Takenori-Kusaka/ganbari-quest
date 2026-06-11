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

async function _updateCardStatus(
	childId: number,
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
) {
	return getRepos().stampCard.updateCardStatus(childId, cardId, input, tenantId);
}

/** #2845 課題①: childId 所有権検証付き (composite key)。不一致なら affected=0。 */
export async function updateCardStatusIfCollecting(
	childId: number,
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
) {
	return getRepos().stampCard.updateCardStatusIfCollecting(childId, cardId, input, tenantId);
}
