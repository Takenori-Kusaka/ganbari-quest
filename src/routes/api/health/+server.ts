import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DATA_SOURCE = process.env.DATA_SOURCE ?? 'sqlite';

async function checkSqlite(): Promise<void> {
	const { rawSqlite } = await import('$lib/server/db/client');
	const row = rawSqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
	if (!row || row.ok !== 1) {
		throw new Error('db_check_failed');
	}
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
	try {
		if (DATA_SOURCE === 'dynamodb') {
			await checkDynamoDB();
		} else {
			await checkSqlite();
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
		version: '0.1.0',
		dataSource: DATA_SOURCE,
	});
};
