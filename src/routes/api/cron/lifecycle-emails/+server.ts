// POST /api/cron/lifecycle-emails — 期限切れ前リマインド + 休眠復帰メール cron (#1601)
//
// EventBridge (Scheduled Rule) から日次で呼び出される。
// 認証は x-cron-secret ヘッダ (verifyCronAuth 共通ヘルパ)。
//
// 使い方:
//   POST /api/cron/lifecycle-emails
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// dryRun=true の場合、状態は変更せずに送信予定件数だけを返す。
//
// ADR-0023 §3.2 §3.3 §5 I11 の通り、本エンドポイントは:
//   - 親オーナー (role='owner') の email にのみ送信
//   - 1 テナントあたり年 6 回のマーケティングメール上限を遵守
//   - List-Unsubscribe ヘッダを必ず付与 (特定電子メール法 + RFC 8058)

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { runLifecycleEmails } from '$lib/server/services/lifecycle-email-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
		const dryRun = body.dryRun === true;

		const result = await runLifecycleEmails({ dryRun });

		logger.info('[lifecycle-emails] cron completed', { context: { ...result } });

		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[lifecycle-emails] cron failed', {
			service: 'lifecycle-emails',
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		return json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
};

/**
 * GET ヘルスチェック — dryRun=true で自動実行し、env 注入と DB 接続を検証。
 */
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const result = await runLifecycleEmails({ dryRun: true });
		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[lifecycle-emails] healthcheck failed', {
			service: 'lifecycle-emails',
			error: err instanceof Error ? err.message : String(err),
		});
		return json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
};
