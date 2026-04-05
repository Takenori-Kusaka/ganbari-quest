// src/lib/server/db/dynamodb/trial-history-repo.ts
// DynamoDB stub for ITrialHistoryRepo (#314)

import type {
	InsertTrialHistoryInput,
	TrialHistoryRow,
} from '../interfaces/trial-history-repo.interface';

export async function findLatestByTenant(_tenantId: string): Promise<TrialHistoryRow | undefined> {
	// TODO: DynamoDB implementation
	return undefined;
}

export async function insert(_input: InsertTrialHistoryInput): Promise<void> {
	// TODO: DynamoDB implementation
}
