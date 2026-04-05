// src/lib/server/db/dynamodb/stamp-card-repo.ts
// DynamoDB stub implementation of IStampCardRepo

import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';

export async function findEnabledStampMasters(_tenantId: string): Promise<StampMaster[]> {
	throw new Error('stamp-card-repo: DynamoDB not implemented');
}

export async function findCardByChildAndWeek(
	_childId: number,
	_weekStart: string,
	_tenantId: string,
): Promise<StampCard | undefined> {
	throw new Error('stamp-card-repo: DynamoDB not implemented');
}

export async function insertCard(
	_input: InsertStampCardInput,
	_tenantId: string,
): Promise<StampCard> {
	throw new Error('stamp-card-repo: DynamoDB not implemented');
}

export async function findEntriesWithMasterByCardId(
	_cardId: number,
	_tenantId: string,
): Promise<StampEntryWithMaster[]> {
	throw new Error('stamp-card-repo: DynamoDB not implemented');
}

export async function insertEntry(_input: InsertStampEntryInput, _tenantId: string): Promise<void> {
	throw new Error('stamp-card-repo: DynamoDB not implemented');
}

export async function updateCardStatus(
	_cardId: number,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<void> {
	throw new Error('stamp-card-repo: DynamoDB not implemented');
}

export async function updateCardStatusIfCollecting(
	_cardId: number,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<number> {
	throw new Error('stamp-card-repo: DynamoDB not implemented');
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	throw new Error('DynamoDB deleteByTenantId for stamp-card-repo not implemented');
}
