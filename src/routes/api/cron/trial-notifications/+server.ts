// POST /api/cron/trial-notifications — トライアル終了通知 cron (#737)
//
// EventBridge (Scheduled Rule) から日次で呼び出される想定。
// 認証は CRON_SECRET の Bearer token で行う。
//
// 使い方:
//   POST /api/cron/trial-notifications
//   Authorization: Bearer <CRON_SECRET>
//   Body (任意): { "tenantIds": ["tenant-1", ...] }
//
// tenantIds を省略した場合はアクティブなトライアルを持つ全テナントを対象にする。

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { processTrialNotifications } from '$lib/server/services/trial-notification-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	verifyCronAuth(request);

	try {
		const body = (await request.json().catch(() => ({}))) as {
			tenantIds?: string[];
		};

		let tenantIds: string[] = body.tenantIds ?? [];

		// tenantIds が指定されなかった場合、アクティブなトライアルを持つテナントを取得
		if (tenantIds.length === 0) {
			const repos = getRepos();
			const activeTrials = await repos.trialHistory.findActiveTrials();
			tenantIds = activeTrials.map((t: { tenantId: string }) => t.tenantId);
		}

		const result = await processTrialNotifications(tenantIds);

		logger.info('[trial-notifications] cron completed', {
			context: { ...result, totalTenants: tenantIds.length },
		});

		return json({
			ok: true,
			totalTenants: tenantIds.length,
			...result,
		});
	} catch (e) {
		logger.error('[trial-notifications] cron failed', {
			service: 'trial-notifications',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};
