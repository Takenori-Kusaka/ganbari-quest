// src/routes/api/cron/expire-redemptions/+server.ts
// 30日以上 pending の交換申請を expired に移行する日次 cron (#1337 / #4682 F3)
//
// EventBridge (Scheduled Rule, 日次) / NUC scheduler / 手動実行から呼ばれる。
// 認証は verifyCronAuth パターン（src/lib/server/auth/cron-auth.ts）
//
// #4682 F3: 旧実装は `expireOldRedemptions('default')` を直に呼んでおり、
// `default` 以外のテナントを 1 件も処理しなかった (加えて schedule-registry に載っておらず
// どの runtime でもスケジュールされていなかった)。結果、子供のごほうびは「うけとりまち」の
// まま無期限に残り、履歴の「きげんぎれ」ラベルは到達不能だった。全テナントを回す。
//
// レスポンス:
//   200 { ok: true, expiredCount, tenantsTotal, tenantsProcessed, tenantsRemaining,
//         budgetExceeded, failures }
//   401 Unauthorized
//   500 Internal error

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { expireOldRedemptionsForAllTenants } from '$lib/server/services/reward-redemption-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const result = await expireOldRedemptionsForAllTenants();
		logger.info('[cron/expire-redemptions] completed', { context: { ...result } });
		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[cron/expire-redemptions] failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		// #3571 (ADR-0062 §2): 内部例外を response へ露出しない (詳細は上記 logger のみ)
		return json({ ok: false, error: 'Internal error' }, { status: 500 });
	}
};
