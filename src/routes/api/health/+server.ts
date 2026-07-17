import { json } from '@sveltejs/kit';
import { probePg, probeSqlite, type SqliteProbeResult } from '$lib/server/db/probe';
import { APP_VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

const DATA_SOURCE = process.env.DATA_SOURCE ?? 'sqlite';

// #3184 item4: liveness probe の raw DB touch は db/probe facade に集約 (route↔DB 境界 / ADR-0061)。
// #3620 AC-C5: dsql/pglite は probePg で**実 backend を実接続 probe** する (従来は sqlite 以外を
// 一律 sqlite probe しており、pg 系 backend でも空 sqlite 経由で 200 を返す偽陽性だった)。
// DynamoDB backend probe は EPIC #3424 / #3438 Phase 3 で撤去済 (prod=dsql)。
export const GET: RequestHandler = async () => {
	let schemaInfo: Partial<SqliteProbeResult> = {};
	try {
		if (DATA_SOURCE === 'dsql' || DATA_SOURCE === 'pglite') {
			schemaInfo = await probePg(DATA_SOURCE);
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
