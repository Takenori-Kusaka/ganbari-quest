// POST /api/cron/deletion-warning-emails — アカウント削除予告メール cron (#2399)
//
// EventBridge (Scheduled Rule) → cron-dispatcher Lambda から日次で呼び出される。
// 認証は verifyCronAuth (Authorization: Bearer / x-cron-secret の両ヘッダを受理)。
//
// 使い方:
//   POST /api/cron/deletion-warning-emails
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { ok, scanned, sent, skipped*, errors, tenantsRemaining, dryRun }
//   401 Unauthorized (CRON_SECRET 設定済 + ヘッダ不一致)
//   500 CRON_SECRET 未設定 かつ AUTH_MODE≠local (本番設定ミスの検出) / 内部エラー
//
// 設計 SSOT: docs/runbooks/account-deletion-email-automation.md

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { runDeletionWarningEmails } from '$lib/server/services/deletion-warning-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
		const result = await runDeletionWarningEmails({ dryRun: body.dryRun === true });

		logger.info('[deletion-warning-emails] cron completed', { context: { ...result } });

		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[deletion-warning-emails] cron failed', {
			service: 'deletion-warning-emails',
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		// ADR-0062 §2: 内部例外を response へ露出しない (詳細は上記 logger のみ)
		return json({ ok: false, error: 'Internal error' }, { status: 500 });
	}
};

/**
 * GET ヘルスチェック — dryRun=true で自動実行し、env 注入と DB 接続を検証する。
 */
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const result = await runDeletionWarningEmails({ dryRun: true });
		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[deletion-warning-emails] healthcheck failed', {
			service: 'deletion-warning-emails',
			error: err instanceof Error ? err.message : String(err),
		});
		return json({ ok: false, error: 'Internal error' }, { status: 500 });
	}
};
