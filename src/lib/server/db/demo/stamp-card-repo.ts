// Demo IStampCardRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';

export async function findEnabledStampMasters(_tenantId: string): Promise<StampMaster[]> {
	return [];
}

export async function findCardByChildAndWeek(
	_childId: number,
	_weekStart: string,
	_tenantId: string,
): Promise<StampCard | undefined> {
	return undefined;
}

export async function insertCard(
	input: InsertStampCardInput,
	_tenantId: string,
): Promise<StampCard> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		weekStart: input.weekStart,
		weekEnd: input.weekEnd,
		status: input.status ?? 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function findEntriesWithMasterByCardId(
	_cardId: number,
	_tenantId: string,
): Promise<StampEntryWithMaster[]> {
	return [];
}

export async function insertEntry(_input: InsertStampEntryInput, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function updateCardStatus(
	_cardId: number,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function updateCardStatusIfCollecting(
	_cardId: number,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
