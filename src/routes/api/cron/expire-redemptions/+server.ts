// src/routes/api/cron/expire-redemptions/+server.ts
// 30日以上 pending の交換申請を expired に移行する日次 cron (#1337)
//
// EventBridge (Scheduled Rule, 日次) または手動実行から呼ばれる。
// 認証は verifyCronAuth パターン（src/lib/server/auth/cron-auth.ts）

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { expireOldRedemptions } from '$lib/server/services/reward-redemption-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		// SQLite シングルテナントのため tenantId は固定（'default'）
		const expiredCount = await expireOldRedemptions('default');
		logger.info('[cron/expire-redemptions] completed', { context: { expiredCount } });
		return json({ ok: true, expiredCount });
	} catch (err) {
		logger.error('[cron/expire-redemptions] failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		return json({ ok: false, error: String(err) }, { status: 500 });
	}
};
