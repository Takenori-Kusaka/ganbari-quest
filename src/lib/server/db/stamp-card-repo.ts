import type { ChildId } from '$lib/domain/ids';
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

export async function findCardByChildAndWeek(
	childId: ChildId,
	weekStart: string,
	tenantId: string,
) {
	return getRepos().stampCard.findCardByChildAndWeek(childId, weekStart, tenantId);
}

/** #4687: 今週より前の未交換カード (古い順)。 */
export async function findUnredeemedCardsBefore(
	childId: ChildId,
	weekStart: string,
	tenantId: string,
) {
	return getRepos().stampCard.findUnredeemedCardsBefore(childId, weekStart, tenantId);
}

export async function insertCard(input: InsertStampCardInput, tenantId: string) {
	return getRepos().stampCard.insertCard(input, tenantId);
}

export async function findEntriesWithMasterByCardId(cardId: string, tenantId: string) {
	return getRepos().stampCard.findEntriesWithMasterByCardId(cardId, tenantId);
}

export async function insertEntry(input: InsertStampEntryInput, tenantId: string) {
	return getRepos().stampCard.insertEntry(input, tenantId);
}

async function _updateCardStatus(
	childId: ChildId,
	cardId: string,
	input: UpdateStampCardStatusInput,
	tenantId: string,
) {
	return getRepos().stampCard.updateCardStatus(childId, cardId, input, tenantId);
}

/** #2845 課題①: childId 所有権検証付き (composite key)。不一致なら affected=0。 */
export async function updateCardStatusIfCollecting(
	childId: ChildId,
	cardId: string,
	input: UpdateStampCardStatusInput,
	tenantId: string,
) {
	return getRepos().stampCard.updateCardStatusIfCollecting(childId, cardId, input, tenantId);
}
