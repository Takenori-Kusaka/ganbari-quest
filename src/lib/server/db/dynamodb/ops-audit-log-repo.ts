// src/lib/server/db/dynamodb/ops-audit-log-repo.ts
// DynamoDB stub for IOpsAuditLogRepo (#820)
// 実装は PR-C で CDK に DynamoDB テーブルを追加するタイミングで差し替える。
// 現時点では no-op でインタフェース契約のみ満たす。

import type {
	InsertOpsAuditLogInput,
	OpsAuditLogRow,
} from '../interfaces/ops-audit-log-repo.interface';

export async function insert(_input: InsertOpsAuditLogInput): Promise<void> {
	// TODO(#820 PR-C): DynamoDB 実装。
	// PK = 'OPS_AUDIT' / SK = `${createdAt}#${actorId}` を予定。
}

export async function findRecent(_limit: number): Promise<OpsAuditLogRow[]> {
	// TODO(#820 PR-C): DynamoDB 実装
	return [];
}

export async function findByActor(_actorId: string, _limit: number): Promise<OpsAuditLogRow[]> {
	// TODO(#820 PR-C): DynamoDB 実装
	return [];
}
