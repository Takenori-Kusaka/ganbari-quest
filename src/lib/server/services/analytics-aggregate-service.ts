// src/lib/server/services/analytics-aggregate-service.ts
//
// #1693 (#1639 follow-up): Analytics 事前集計サービス
//
// EventBridge cron (gq-analytics-aggregator-daily / 03:00 JST = 18:00 UTC) から
// 呼び出され、前日分の activation funnel + cancellation reason の集計を計算して
// DynamoDB の `PK=ANALYTICS_AGG#<YYYY-MM-DD>` に書き込む。
//
// 設計:
//   - cron は **前日 1 日分のスナップショット** を 1 日 1 回書く
//   - read 側 (`/admin/analytics`) は期間内日付の集計レコードを取得し、
//     見つからない日付分のみライブ計算で補う (analytics-service.ts §fallback)
//   - レコードは TTL 365 日で自動失効
//
// Pre-PMF (ADR-0010, ~100 テナント想定):
//   - Funnel: 1 日あたり最大 4 events × ~100 tenant ≒ 数 KB / レコード
//   - Cancellation: 1 日あたり 0〜数件 (Pre-PMF では稀) → サイズ無視可
//
// Idempotency:
//   - 同じ date を 2 回処理しても DynamoDB Put は同じキーで上書きされるため安全
//   - dryRun=true は実書込みを行わず計算結果だけを返す (smoke test 用)

import {
	ANALYTICS_AGG_KIND,
	type CancellationDailyAggregate,
	type FunnelDailyAggregate,
	putAnalyticsAggregate,
} from '$lib/analytics/providers/dynamo';
import { logger } from '$lib/server/logger';

/**
 * Activation funnel events (services/analytics-service.ts と同期 — SSOT は `getActivationFunnel`)
 */
const ACTIVATION_FUNNEL_EVENT_NAMES = [
	'activation_signup_completed',
	'activation_first_child_added',
	'activation_first_activity_completed',
	'activation_first_reward_seen',
] as const;

export interface AnalyticsAggregateRunResult {
	ok: boolean;
	targetDate: string;
	dryRun: boolean;
	funnel: {
		written: boolean;
		uniqueTenantsByEvent: Record<string, number>;
		error: string | null;
	};
	cancellation: {
		written: boolean;
		total30d: number;
		total90d: number;
		error: string | null;
	};
}

export interface RunAnalyticsAggregationOptions {
	dryRun?: boolean;
	/** Override target date (UTC YYYY-MM-DD); default = 前日 (UTC 基準) */
	targetDate?: string;
}

/**
 * 前日 (UTC) の YYYY-MM-DD を返す
 */
function defaultTargetDate(now: Date = new Date()): string {
	const yesterdayMs = now.getTime() - 24 * 60 * 60 * 1000;
	return new Date(yesterdayMs).toISOString().slice(0, 10);
}

/**
 * 前日分の activation funnel スナップショット集計
 *
 * 各 event について、その日に発火させた unique tenant 一覧を取得する。
 * Pre-PMF: 1 日あたり最大数百 tenant ID で十分（HLL 等の近似 sketch は post-PMF）。
 *
 * 内部で `queryAnalyticsEventTenants` の dedicated 抽出を使うが、tenantId 一覧が
 * 必要なため lower-level GSI2 query を直接実行する。失敗時は空 record を返す
 * （analytics は never break the app の原則）。
 */
async function aggregateFunnelForDate(date: string): Promise<FunnelDailyAggregate> {
	const tenantsByEvent: Record<string, string[]> = {};

	try {
		const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
		const { getDocClient, TABLE_NAME } = await import('$lib/server/db/dynamodb/client');

		for (const eventName of ACTIVATION_FUNNEL_EVENT_NAMES) {
			const tenantSet = new Set<string>();
			let exclusiveStartKey: Record<string, unknown> | undefined;
			do {
				const res = await getDocClient().send(
					new QueryCommand({
						TableName: TABLE_NAME,
						IndexName: 'GSI2',
						KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
						ExpressionAttributeValues: {
							':pk': `ANALYTICS#EVENT#${eventName}`,
							':sk': `${date}#`,
						},
						ExclusiveStartKey: exclusiveStartKey,
					}),
				);
				for (const item of res.Items ?? []) {
					const tenantId = item.tenantId as string | undefined;
					if (tenantId) tenantSet.add(tenantId);
				}
				exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
			} while (exclusiveStartKey);
			tenantsByEvent[eventName] = Array.from(tenantSet);
		}
	} catch (err) {
		logger.warn('[analytics-aggregate] funnel query failed', {
			context: { date, error: err instanceof Error ? err.message : String(err) },
		});
		// 部分結果を返す（per-event failure ではなく query 全体 failure 時のみ空 record）
		for (const eventName of ACTIVATION_FUNNEL_EVENT_NAMES) {
			if (!tenantsByEvent[eventName]) tenantsByEvent[eventName] = [];
		}
	}

	return { date, tenantsByEvent };
}

/**
 * 30d / 90d 期間の cancellation 集計を 1 日分 snapshot として保存する。
 *
 * 注意: cancellation は元々低頻度 (Pre-PMF: <10/月) で event log と異なり既存
 * `cancellation_reasons` テーブルに永続保存されるため、aggregate レコードは
 * 「特定 read window の集計結果スナップショット」として 30d / 90d 別々に持つ。
 */
async function aggregateCancellationForDate(
	date: string,
): Promise<{ d30: CancellationDailyAggregate; d90: CancellationDailyAggregate }> {
	const { getCancellationReasonAggregation } = await import('./cancellation-service');
	const [r30, r90] = await Promise.all([
		getCancellationReasonAggregation(30),
		getCancellationReasonAggregation(90),
	]);

	const d30: CancellationDailyAggregate = {
		date,
		total: r30.total,
		breakdown: r30.breakdown.map((b) => ({ category: b.category, count: b.count })),
	};
	const d90: CancellationDailyAggregate = {
		date,
		total: r90.total,
		breakdown: r90.breakdown.map((b) => ({ category: b.category, count: b.count })),
	};
	return { d30, d90 };
}

/**
 * 前日分の analytics 集計を計算して DynamoDB に書き込む (#1693)。
 *
 * cron Lambda (`/api/cron/analytics-aggregate`) から呼ばれる。
 * dryRun=true なら計算のみ実行し、書込みはスキップする。
 */
export async function runAnalyticsAggregation(
	options: RunAnalyticsAggregationOptions = {},
): Promise<AnalyticsAggregateRunResult> {
	const dryRun = options.dryRun === true;
	const targetDate = options.targetDate ?? defaultTargetDate();

	const result: AnalyticsAggregateRunResult = {
		ok: true,
		targetDate,
		dryRun,
		funnel: { written: false, uniqueTenantsByEvent: {}, error: null },
		cancellation: { written: false, total30d: 0, total90d: 0, error: null },
	};

	// ── Funnel ────────────────────────────────────────────────
	try {
		const funnelAgg = await aggregateFunnelForDate(targetDate);
		for (const [event, tenants] of Object.entries(funnelAgg.tenantsByEvent)) {
			result.funnel.uniqueTenantsByEvent[event] = tenants.length;
		}
		if (!dryRun) {
			const putRes = await putAnalyticsAggregate(targetDate, ANALYTICS_AGG_KIND.FUNNEL, funnelAgg);
			result.funnel.written = putRes.ok;
			result.funnel.error = putRes.error ?? null;
		}
	} catch (err) {
		result.funnel.error = err instanceof Error ? err.message : String(err);
		logger.error('[analytics-aggregate] funnel aggregation failed', {
			service: 'analytics-aggregate',
			error: result.funnel.error,
		});
	}

	// ── Cancellation ──────────────────────────────────────────
	try {
		const { d30, d90 } = await aggregateCancellationForDate(targetDate);
		result.cancellation.total30d = d30.total;
		result.cancellation.total90d = d90.total;
		if (!dryRun) {
			const [put30, put90] = await Promise.all([
				putAnalyticsAggregate(targetDate, ANALYTICS_AGG_KIND.CANCELLATION_30D, d30),
				putAnalyticsAggregate(targetDate, ANALYTICS_AGG_KIND.CANCELLATION_90D, d90),
			]);
			result.cancellation.written = put30.ok && put90.ok;
			result.cancellation.error = put30.error ?? put90.error ?? null;
		}
	} catch (err) {
		result.cancellation.error = err instanceof Error ? err.message : String(err);
		logger.error('[analytics-aggregate] cancellation aggregation failed', {
			service: 'analytics-aggregate',
			error: result.cancellation.error,
		});
	}

	result.ok = !result.funnel.error && !result.cancellation.error;
	return result;
}
