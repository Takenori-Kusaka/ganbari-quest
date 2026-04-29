// POST /api/cron/analytics-aggregate — analytics 事前集計 cron (#1693 / #1639 follow-up)
//
// EventBridge Rule `gq-analytics-aggregator-daily` から 1 日 1 回 03:00 JST (= 18:00 UTC)
// に呼び出される。前日 (UTC) 1 日分の activation funnel + cancellation reason 集計を計算し、
// `PK=ANALYTICS_AGG#<YYYY-MM-DD>` レコードに書き込む。
//
// 認証: x-cron-secret ヘッダ (verifyCronAuth 共通ヘルパ — 既存 cron と同一パターン)
// 設計: docs/design/13-AWSサーバレスアーキテクチャ設計書.md §7.2
//
// 使い方:
//   POST /api/cron/analytics-aggregate
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true, "targetDate": "2026-04-28" }
//
// dryRun=true の場合、計算のみ実行し DynamoDB への書き込みはスキップする
// (post-deploy smoke test 用)。
//
// ADR-0010 Pre-PMF:
//   - スコープは funnel + cancellation のみ。Sean Ellis / retention cohort は
//     集計頻度が低い（半年に 1 round / 月次）ため対象外 (Issue #1693 スコープ外)
//   - GSI 追加なし、DynamoDB 既存テーブルに事前集計レコードを書き込むのみ
//   - TTL 365 日で自動失効 (時系列 trend 確認のため event log 90 日より長い)

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { runAnalyticsAggregation } from '$lib/server/services/analytics-aggregate-service';
import type { RequestHandler } from './$types';

interface AnalyticsAggregateCronBody {
	dryRun?: boolean;
	targetDate?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const body = (await request.json().catch(() => ({}))) as AnalyticsAggregateCronBody;
		const dryRun = body.dryRun === true;
		const targetDate =
			typeof body.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
				? body.targetDate
				: undefined;

		const result = await runAnalyticsAggregation({ dryRun, targetDate });

		logger.info('[analytics-aggregate] cron completed', {
			context: {
				targetDate: result.targetDate,
				dryRun: result.dryRun,
				ok: result.ok,
				funnelWritten: result.funnel.written,
				cancellationWritten: result.cancellation.written,
				funnelEvents: Object.keys(result.funnel.uniqueTenantsByEvent).length,
			},
		});

		return json(result);
	} catch (err) {
		logger.error('[analytics-aggregate] cron failed', {
			service: 'analytics-aggregate',
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
		const result = await runAnalyticsAggregation({ dryRun: true });
		return json(result);
	} catch (err) {
		logger.error('[analytics-aggregate] healthcheck failed', {
			service: 'analytics-aggregate',
			error: err instanceof Error ? err.message : String(err),
		});
		return json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
};
