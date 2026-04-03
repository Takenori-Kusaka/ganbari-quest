// src/routes/api/v1/admin/migration/+server.ts
// スキーママイグレーション統計 + バッチ実行エンドポイント

import { logger } from '$lib/server/logger';
import {
	getMigrationStats,
	runAllBatchMigrations,
} from '$lib/server/db/migration/batch';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

function verifyCronAuth(request: Request): Response | null {
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret) {
		const authHeader = request.headers.get('x-cron-secret');
		if (authHeader !== cronSecret) {
			return json({ error: 'Unauthorized' }, { status: 401 }) as unknown as Response;
		}
	} else if (process.env.AUTH_MODE !== 'local') {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 }) as unknown as Response;
	}
	return null;
}

/** GET: マイグレーション統計を返す */
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const stats = getMigrationStats();
		return json({ success: true, stats });
	} catch (err) {
		logger.error('[migration-api] Stats failed', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

/** POST: バッチマイグレーションを実行 */
export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	const body = (await request.json().catch(() => ({}))) as {
		dryRun?: boolean;
		limit?: number;
	};
	const dryRun = body.dryRun ?? true;
	const limit = body.limit ?? 500;

	try {
		const results = runAllBatchMigrations({ limit, dryRun });
		const totalMigrated = results.reduce((sum, r) => sum + r.migrated, 0);
		const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

		logger.info('[migration-api] Batch migration completed', {
			context: { dryRun, totalMigrated, totalFailed },
		});

		return json({
			success: true,
			dryRun,
			results,
			summary: { totalMigrated, totalFailed },
		});
	} catch (err) {
		logger.error('[migration-api] Batch migration failed', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
