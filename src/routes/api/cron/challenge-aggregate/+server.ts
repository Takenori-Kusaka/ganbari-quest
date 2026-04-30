// POST /api/cron/challenge-aggregate — challenge 事前集計 cron (#1742)
//
// EventBridge Rule `gq-challenge-aggregator-daily` から 1 日 1 回 03:30 JST (= 18:30 UTC)
// に呼び出される。当日 (UTC) 時点の全テナントの `questionnaire_challenges` 設定値を集計し、
// `PK=CHALLENGE_AGG#<YYYY-MM-DD>` レコードに書き込む。
//
// 認証: Authorization: Bearer / x-cron-secret (verifyCronAuth — 既存 cron と同一パターン)
// 設計: docs/design/13-AWSサーバレスアーキテクチャ設計書.md §6.x ops/analytics
//
// 使い方:
//   POST /api/cron/challenge-aggregate
//   Authorization: Bearer <CRON_SECRET>
//   Body (任意): { "dryRun": true, "targetDate": "2026-04-30" }
//
// dryRun=true の場合、計算のみ実行し DynamoDB への書き込みはスキップする
// (post-deploy smoke test 用)。
//
// ADR-0010 Pre-PMF:
//   - スコープは preset distribution のみ。GSI 追加なし、DynamoDB 既存テーブルに集計レコードを書く
//   - TTL 365 日で自動失効 (時系列 trend 確認のため)
//   - 関連: PR #1696 (analytics-aggregate cron) 同パターン

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { runChallengeAggregation } from '$lib/server/services/challenge-aggregate-service';
import type { RequestHandler } from './$types';

interface ChallengeAggregateCronBody {
	dryRun?: boolean;
	targetDate?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const body = (await request.json().catch(() => ({}))) as ChallengeAggregateCronBody;
		const dryRun = body.dryRun === true;
		const targetDate =
			typeof body.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
				? body.targetDate
				: undefined;

		const result = await runChallengeAggregation({ dryRun, targetDate });

		logger.info('[challenge-aggregate] cron completed', {
			context: {
				targetDate: result.targetDate,
				dryRun: result.dryRun,
				ok: result.ok,
				written: result.written,
				totalTenants: result.totalTenants,
			},
		});

		return json(result);
	} catch (err) {
		logger.error('[challenge-aggregate] cron failed', {
			service: 'challenge-aggregate',
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
 * GET ヘルスチェック — dryRun=true で自動実行し、env 注入と DynamoDB 接続を検証。
 */
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const result = await runChallengeAggregation({ dryRun: true });
		return json(result);
	} catch (err) {
		logger.error('[challenge-aggregate] healthcheck failed', {
			service: 'challenge-aggregate',
			error: err instanceof Error ? err.message : String(err),
		});
		return json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
};
