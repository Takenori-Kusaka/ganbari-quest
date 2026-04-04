import { json } from '@sveltejs/kit';
import { APP_VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

const DATA_SOURCE = process.env.DATA_SOURCE ?? 'sqlite';

async function checkSqlite(): Promise<{
	schemaValid?: boolean;
	migrationsApplied?: number;
	schemaWarnings?: number;
}> {
	const { rawSqlite } = await import('$lib/server/db/client');
	const row = rawSqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
	if (!row || row.ok !== 1) {
		throw new Error('db_check_failed');
	}
	// スキーマ検証結果を返す
	const { getLastValidationResult } = await import('$lib/server/db/schema-validator');
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

async function checkDynamoDB(): Promise<void> {
	const { DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
	const { getDocClient, TABLE_NAME } = await import('$lib/server/db/dynamodb/client');
	const result = await getDocClient().send(new DescribeTableCommand({ TableName: TABLE_NAME }));
	if (result.Table?.TableStatus !== 'ACTIVE') {
		throw new Error('dynamodb_table_not_active');
	}
}

export const GET: RequestHandler = async () => {
	let schemaInfo: { schemaValid?: boolean; migrationsApplied?: number; schemaWarnings?: number } =
		{};
	try {
		if (DATA_SOURCE === 'dynamodb') {
			await checkDynamoDB();
		} else {
			schemaInfo = await checkSqlite();
		}
	} catch (e) {
		return json(
			{
				status: 'error',
				error: e instanceof Error ? e.message : 'db_unreachable',
				dataSource: DATA_SOURCE,
			},
			{ status: 503 },
		);
	}

	return json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		version: APP_VERSION,
		dataSource: DATA_SOURCE,
		region: process.env.AWS_REGION ?? 'local',
		uptime: Math.floor(process.uptime()),
		schema: schemaInfo,
	});
};
