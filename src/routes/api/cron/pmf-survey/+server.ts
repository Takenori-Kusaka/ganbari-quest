// POST /api/cron/pmf-survey — PMF 判定アンケートメール cron (#1598 / ADR-0023 §5 I7)
//
// EventBridge (Scheduled Rule) から年 2 回 (6/1 + 12/1 09:00 JST) 呼び出される。
// 認証は x-cron-secret ヘッダ (verifyCronAuth 共通ヘルパ)。
//
// 使い方:
//   POST /api/cron/pmf-survey
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true, "round": "2026-H1" }
//
// dryRun=true の場合、状態は変更せずに送信予定件数だけを返す。
//
// Anti-engagement / 接触頻度上限 (ADR-0023 §3.3):
//   - 親オーナー (role='owner') の email にのみ送信
//   - #1601 lifecycle-emails と共有の年 6 回上限カウンタを消費
//   - List-Unsubscribe ヘッダを必ず付与 (特定電子メール法 + RFC 8058)

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { runPmfSurveyDistribution } from '$lib/server/services/pmf-survey-service';
import type { RequestHandler } from './$types';

interface PmfSurveyCronBody {
	dryRun?: boolean;
	round?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const body = (await request.json().catch(() => ({}))) as PmfSurveyCronBody;
		const dryRun = body.dryRun === true;
		const round = typeof body.round === 'string' ? body.round : undefined;

		const result = await runPmfSurveyDistribution({ dryRun, round });

		logger.info('[pmf-survey] cron completed', { context: { ...result } });

		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[pmf-survey] cron failed', {
			service: 'pmf-survey',
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
		const result = await runPmfSurveyDistribution({ dryRun: true });
		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[pmf-survey] healthcheck failed', {
			service: 'pmf-survey',
			error: err instanceof Error ? err.message : String(err),
		});
		return json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
};
