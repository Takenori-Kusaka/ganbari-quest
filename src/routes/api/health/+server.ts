import { rawSqlite } from '$lib/server/db/client';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		// DB connectivity check
		const row = rawSqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
		if (!row || row.ok !== 1) {
			return json({ status: 'error', error: 'db_check_failed' }, { status: 503 });
		}
	} catch (e) {
		return json(
			{ status: 'error', error: e instanceof Error ? e.message : 'db_unreachable' },
			{ status: 503 },
		);
	}

	return json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		version: '0.1.0',
	});
};
