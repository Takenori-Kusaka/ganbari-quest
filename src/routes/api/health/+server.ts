import { json } from '@sveltejs/kit';
import { probeDynamoDB, probeSqlite, type SqliteProbeResult } from '$lib/server/db/probe';
import { APP_VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

const DATA_SOURCE = process.env.DATA_SOURCE ?? 'sqlite';

// #3184 item4: liveness probe の raw DB touch は db/probe facade に集約 (route↔DB 境界 / ADR-0061)。
export const GET: RequestHandler = async () => {
	let schemaInfo: Partial<SqliteProbeResult> = {};
	try {
		if (DATA_SOURCE === 'dynamodb') {
			await probeDynamoDB();
		} else {
			schemaInfo = await probeSqlite();
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
