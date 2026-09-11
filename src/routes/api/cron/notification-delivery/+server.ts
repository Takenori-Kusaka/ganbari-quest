// POST /api/cron/notification-delivery — 通知 / 週次レポート配信 cron (#4706)
//
// EventBridge (Scheduled Rule) → cron-dispatcher Lambda / NUC scheduler から 15 分ごとに
// 呼び出される。認証は verifyCronAuth (Authorization: Bearer / x-cron-secret の両ヘッダを受理)。
//
// 使い方:
//   POST /api/cron/notification-delivery
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { ok, scanned, weeklyReportSent, reminderSent, streakWarningSent, errors,
//         tenantsRemaining, dryRun }
//   401 Unauthorized (CRON_SECRET 設定済 + ヘッダ不一致)
//   500 CRON_SECRET 未設定 かつ AUTH_MODE≠local (本番設定ミスの検出) / 内部エラー
//
// 設計 SSOT: docs/design/07-API設計書.md / docs/operations/notification-runbook.md

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { runNotificationDelivery } from '$lib/server/services/notification-delivery-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
		const result = await runNotificationDelivery({ dryRun: body.dryRun === true });

		logger.info('[notification-delivery] cron completed', { context: { ...result } });

		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[notification-delivery] cron failed', {
			service: 'notification-delivery',
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		// ADR-0062 §2: 内部例外を response へ露出しない (詳細は上記 logger のみ)
		return json({ ok: false, error: 'Internal error' }, { status: 500 });
	}
};

/**
 * GET ヘルスチェック — dryRun=true で自動実行し、env 注入と DB 接続を検証する。
 * (deletion-warning-emails / grace-period-deletion と同じ契約)
 */
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const result = await runNotificationDelivery({ dryRun: true });
		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[notification-delivery] healthcheck failed', {
			service: 'notification-delivery',
			error: err instanceof Error ? err.message : String(err),
		});
		return json({ ok: false, error: 'Internal error' }, { status: 500 });
	}
};
