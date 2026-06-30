// src/lib/server/db/probe.ts
// liveness probe facade (#3184 item4)。
//
// /api/health は SQLite (rawSqlite ping + schema validation) / DynamoDB (DescribeTable) の
// 生存確認を行うが、route が `db/client` / `db/dynamodb/*` を直接 import すると route↔DB 境界
// fitness function (route-db-boundary.test.ts / ADR-0061) の違反になる。raw client touch を本
// facade (db/ 層) に集約し、route は本 facade のみを呼ぶ (baseline 違反を解消)。

export interface SqliteProbeResult {
	schemaValid: boolean;
	migrationsApplied: number;
	schemaWarnings: number;
}

/** SQLite liveness + schema 検証。失敗時は Error を throw する。 */
export async function probeSqlite(): Promise<SqliteProbeResult> {
	const { rawSqlite } = await import('./client');
	const row = rawSqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
	if (!row || row.ok !== 1) {
		throw new Error('db_check_failed');
	}
	const { getLastValidationResult } = await import('./schema-validator');
	const schemaResult = getLastValidationResult();
	if (schemaResult && !schemaResult.valid) {
		throw new Error('schema_incompatible');
	}
	return {
		schemaValid: schemaResult?.valid ?? true,
		migrationsApplied: schemaResult?.applied.length ?? 0,
		schemaWarnings: schemaResult?.warnings.length ?? 0,
	};
}

/** DynamoDB liveness (DescribeTable が ACTIVE か)。失敗時は Error を throw する。 */
export async function probeDynamoDB(): Promise<void> {
	const { DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
	const { getDocClient, TABLE_NAME } = await import('./dynamodb/client');
	const result = await getDocClient().send(new DescribeTableCommand({ TableName: TABLE_NAME }));
	if (result.Table?.TableStatus !== 'ACTIVE') {
		throw new Error('dynamodb_table_not_active');
	}
}
