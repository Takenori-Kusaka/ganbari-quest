// src/lib/server/db/probe.ts
// liveness probe facade (#3184 item4)。
//
// /api/health は SQLite (rawSqlite ping + schema validation) / pg 系 backend (dsql / pglite の
// 実接続 SELECT + schema 実在検証) の生存確認を行うが、route が `db/client` 等を直接 import すると
// route↔DB 境界 fitness function (route-db-boundary.test.ts / ADR-0061) の違反になる。raw client
// touch を本 facade (db/ 層) に集約し、route は本 facade のみを呼ぶ (baseline 違反を解消)。
// DynamoDB backend probe (DescribeTable) は EPIC #3424 / #3438 Phase 3 で撤去済 (prod=dsql)。

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

/**
 * pg 系 backend (dsql / pglite) の liveness + schema 検証 (#3620 AC-C5 / EPIC #3424)。
 * **実 backend への実接続**で SELECT 1 + children 表 count を実行する — 従来 health は
 * dynamodb 以外を一律 sqlite probe しており、DATA_SOURCE=dsql/pglite の Lambda/NUC でも
 * 「空 sqlite が触れた」だけで 200 を返す偽陽性だった (staging cycle 3 の反省)。
 * children count が通る = migration 適用済み schema が実在する、を schemaValid とする。
 */
export async function probePg(dataSource: 'dsql' | 'pglite'): Promise<SqliteProbeResult> {
	const { sql } = await import('drizzle-orm');
	const db =
		dataSource === 'dsql'
			? (await import('./dsql/connection')).getDsqlDb()
			: (await import('./pglite/connection')).getPgliteDbSync();
	const ping = await db.execute(sql`SELECT 1 AS ok`);
	if (Number((ping.rows[0] as { ok: number } | undefined)?.ok) !== 1) {
		throw new Error('db_check_failed');
	}
	// schema 実在検証: 中核表 children への count が通れば migration 適用済み。
	await db.execute(sql`SELECT count(*) FROM children`);
	return { schemaValid: true, migrationsApplied: 0, schemaWarnings: 0 };
}
