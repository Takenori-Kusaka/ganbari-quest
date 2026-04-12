// src/lib/server/db/dynamodb/trial-history-repo.ts
// DynamoDB stub for ITrialHistoryRepo (#314, #769)

import type {
	InsertTrialHistoryInput,
	TrialHistoryRow,
	UpdateTrialConversionInput,
} from '../interfaces/trial-history-repo.interface';

export async function findLatestByTenant(_tenantId: string): Promise<TrialHistoryRow | undefined> {
	// TODO: DynamoDB implementation
	return undefined;
}

export async function insert(_input: InsertTrialHistoryInput): Promise<void> {
	// TODO: DynamoDB implementation
}

/** トライアル後のコンバージョン情報を記録（DynamoDB未実装） */
export async function updateConversion(_input: UpdateTrialConversionInput): Promise<void> {
	// TODO: DynamoDB implementation
}

/** テナントの全トライアル履歴を削除（DynamoDB未実装: 書き込みがないため no-op） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// DynamoDB trial-history repo は未実装のため書き込みデータなし — no-op
}
