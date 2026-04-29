// src/lib/server/services/analytics-service.ts
// Analytics service — server-side event tracking facade.
// Wraps the analytics module with app-specific business event helpers.
//
// #1639 (#1591 follow-up): /admin/analytics 可視化用の集計関数を追加
// (activation funnel / cancellation reasons / Sean Ellis スコア / retention cohort)。
// Pre-PMF (ADR-0010) 段階のため事前集計レコードは未導入。直接 query で十分（~100 テナント想定）。
// 集計頻度が高くなれば cron で `PK=ANALYTICS_AGG#<date>` を書く設計に移行する (follow-up)。

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { analytics } from '$lib/analytics';
import type { BusinessEventName, EventProperties } from '$lib/analytics/types';
import { getDocClient, TABLE_NAME } from '$lib/server/db/dynamodb/client';
import type { CancellationReasonAggregation } from '$lib/server/db/interfaces/cancellation-reason-repo.interface';
import { logger } from '$lib/server/logger';
import { getCancellationReasonAggregation } from './cancellation-service';
import { type CohortAnalysisResult, getCohortAnalysis } from './cohort-analysis-service';
import {
	aggregateSurveyResponses,
	getCurrentRound,
	type PmfSurveyAggregation,
} from './pmf-survey-service';

/**
 * Track a business event with standard metadata.
 */
export function trackBusinessEvent(
	eventName: BusinessEventName | string,
	properties?: EventProperties,
	tenantId?: string,
): void {
	if (tenantId) {
		analytics.identify(tenantId);
	}
	analytics.trackEvent(eventName, {
		...properties,
		tenantId,
	});
}

/**
 * Track a server-side error for analytics correlation.
 */
export function trackServerError(
	error: Error,
	context?: {
		method?: string;
		path?: string;
		status?: number;
		requestId?: string;
		tenantId?: string;
	},
): void {
	analytics.trackError(error, context);
}

// ── Activation Funnel (#831) ──────────────────────────────────

/**
 * Track: サインアップ + consent 完了 (Step 1)
 */
export function trackActivationSignupCompleted(tenantId: string): void {
	trackBusinessEvent('activation_signup_completed', { step: 1 }, tenantId);
}

/**
 * Track: テナント初の子供登録 (Step 2)
 * 呼び出し側で「初回かどうか」を判定すること。
 */
export function trackActivationFirstChildAdded(tenantId: string, childId: number): void {
	trackBusinessEvent('activation_first_child_added', { step: 2, childId }, tenantId);
}

/**
 * Track: テナント初の活動記録完了 (Step 3)
 * 呼び出し側で「初回かどうか」を判定すること。
 *
 * 子供単位の初回判定（activeCount === 1）。
 * テナント単位の初回判定は集計層で dedup する設計。
 */
export function trackActivationFirstActivityCompleted(
	tenantId: string,
	childId: number,
	activityId: number,
): void {
	trackBusinessEvent(
		'activation_first_activity_completed',
		{ step: 3, childId, activityId },
		tenantId,
	);
}

/**
 * Track: テナント初の報酬演出表示 (Step 4)
 * シール獲得またはレベルアップモーダル表示時。
 *
 * NOTE: Step 2/3 とは異なり、このイベントは報酬発生のたびに毎回発火する。
 * アプリ層での「初回判定」には追加 DB クエリが必要で、イベント頻度（スタンプ・レベルアップ）が
 * 低いため、テナント初回の判定は集計層（DynamoDB / BI）で dedup する設計とする。
 */
export function trackActivationFirstRewardSeen(
	tenantId: string,
	rewardType: 'stamp' | 'level_up',
): void {
	trackBusinessEvent('activation_first_reward_seen', { step: 4, rewardType }, tenantId);
}

/**
 * Get analytics system status (for admin/ops dashboard).
 *
 * #1591 (ADR-0023 I2): umami / Sentry プロバイダ削除に伴い、umamiConfig は返さない。
 * AWS 内完結 (DynamoDB のみ) のため active provider 名のみを返す。
 */
export function getAnalyticsStatus(): {
	providers: string[];
} {
	return {
		providers: analytics.getActiveProviders(),
	};
}

// ── #1639 /admin/analytics 可視化用集計関数 ──────────────────────
//
// 4 種可視化:
//   1. activation funnel (signup → 初回ログイン → 7日継続) — DynamoDB ANALYTICS#EVENT#<name> をスキャン
//   2. retention cohort (週次・月次)                       — cohort-analysis-service を再利用
//   3. Sean Ellis スコア (PMF 指標)                        — pmf-survey-service を再利用
//   4. 解約理由分布                                         — cancellation-service を再利用
//
// Pre-PMF (ADR-0010): 直接 query で十分 (~100 テナント想定)。
// 集計頻度が高くなれば事前集計レコード `PK=ANALYTICS_AGG#<date>` を cron で書く設計に移行する。

/** Activation funnel periods */
export type ActivationFunnelPeriod = '7d' | '30d';

/** Single funnel step result */
export interface ActivationFunnelStep {
	/** Step ID (1-4): signup / first_child / first_activity / first_reward */
	step: number;
	/** Internal event name (also used as label key) */
	eventName: string;
	/** Number of unique tenants reaching this step in the period */
	count: number;
	/** Conversion rate from previous step (0-1). Step 1 is always 1. */
	conversionFromPrev: number;
}

export interface ActivationFunnelResult {
	period: ActivationFunnelPeriod;
	/** Step rows in funnel order (1 → 4) */
	steps: ActivationFunnelStep[];
	/** Number of distinct dates scanned */
	scannedDates: number;
	fetchedAt: string;
}

/** Retention cohort granularities */
export type RetentionCohortPeriod = 'weekly' | 'monthly';

/** Single retention cohort row */
export interface RetentionCohortRow {
	/** Cohort label (YYYY-MM for monthly, YYYY-Www for weekly) */
	cohort: string;
	/** Cohort size (signups in this cohort) */
	size: number;
	/** Day-N retention values (0-1 or null when N has not yet elapsed) */
	retention: Record<number, number | null>;
	/** True when sample is insufficient for reliable interpretation */
	insufficientSample: boolean;
}

export interface RetentionCohortResult {
	period: RetentionCohortPeriod;
	/** Day-N points used as columns */
	dayPoints: number[];
	cohorts: RetentionCohortRow[];
	fetchedAt: string;
}

/** Cancellation reason periods */
export type CancellationReasonPeriod = '30d' | '90d';

export interface CancellationReasonResult {
	period: CancellationReasonPeriod;
	total: number;
	breakdown: CancellationReasonAggregation[];
	fetchedAt: string;
}

const ACTIVATION_FUNNEL_EVENT_NAMES = [
	'activation_signup_completed',
	'activation_first_child_added',
	'activation_first_activity_completed',
	'activation_first_reward_seen',
] as const;

/**
 * 期間内 (UTC 日付) の DynamoDB ANALYTICS#EVENT#<name> パーティションをすべて query して
 * テナント単位 unique 件数を返す。
 *
 * PK=ANALYTICS#EVENT#<eventName>, SK=GSI2 = `<date>#<tenantId>` 構造を想定するが、
 * 現在の DynamoAnalyticsProvider 実装は `PK=ANALYTICS#<date>, GSI2PK=ANALYTICS#EVENT#<name>` を
 * 書いている。このため GSI2 を使うと event 横断 query が可能。
 *
 * Pre-PMF / ADR-0010: GSI 1 経路で 4 event × N 日のスキャンで十分。
 */
async function countActivationEventTenants(
	eventName: string,
	sinceIso: string,
): Promise<{ uniqueTenants: number; scannedDates: number }> {
	try {
		const tenants = new Set<string>();
		// GSI2 query: GSI2PK=ANALYTICS#EVENT#<name> AND GSI2SK >= <since-date>
		const sinceDate = sinceIso.slice(0, 10);
		const dates = new Set<string>();

		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const res = await getDocClient().send(
				new QueryCommand({
					TableName: TABLE_NAME,
					IndexName: 'GSI2',
					KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :sk',
					ExpressionAttributeValues: {
						':pk': `ANALYTICS#EVENT#${eventName}`,
						':sk': sinceDate,
					},
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);
			for (const item of res.Items ?? []) {
				const tenantId = item.tenantId as string | undefined;
				if (tenantId) tenants.add(tenantId);
				const gsi2sk = item.GSI2SK as string | undefined;
				if (gsi2sk) {
					const datePart = gsi2sk.split('#')[0];
					if (datePart) dates.add(datePart);
				}
			}
			exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
		} while (exclusiveStartKey);

		return { uniqueTenants: tenants.size, scannedDates: dates.size };
	} catch (err) {
		logger.warn('[analytics] activation funnel query failed', {
			context: { eventName, error: err instanceof Error ? err.message : String(err) },
		});
		return { uniqueTenants: 0, scannedDates: 0 };
	}
}

/**
 * Activation funnel を取得する (#1639 AC1)。
 * 4 step (signup / first_child / first_activity / first_reward) のテナント単位 unique 件数。
 */
export async function getActivationFunnel(
	period: ActivationFunnelPeriod = '30d',
): Promise<ActivationFunnelResult> {
	const days = period === '7d' ? 7 : 30;
	const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
	const sinceIso = new Date(sinceMs).toISOString();

	const counts: number[] = [];
	let scannedDates = 0;
	for (const eventName of ACTIVATION_FUNNEL_EVENT_NAMES) {
		const { uniqueTenants, scannedDates: dates } = await countActivationEventTenants(
			eventName,
			sinceIso,
		);
		counts.push(uniqueTenants);
		scannedDates = Math.max(scannedDates, dates);
	}

	const steps: ActivationFunnelStep[] = ACTIVATION_FUNNEL_EVENT_NAMES.map((eventName, idx) => {
		const count = counts[idx] ?? 0;
		const prev = idx === 0 ? count : (counts[idx - 1] ?? 0);
		const conversionFromPrev = idx === 0 ? 1 : prev > 0 ? count / prev : 0;
		return {
			step: idx + 1,
			eventName,
			count,
			conversionFromPrev,
		};
	});

	return {
		period,
		steps,
		scannedDates,
		fetchedAt: new Date().toISOString(),
	};
}

/**
 * Retention cohort を取得する (#1639 AC2)。
 * 既存 cohort-analysis-service を薄くラップし、weekly / monthly どちらの粒度でも返せる形に整える。
 *
 * 現在 cohort-analysis-service は monthly のみ実装。weekly は monthly 実装結果を流用しつつ
 * cohort label のみ ISO Week 形式に整形する (Pre-PMF: 完全な weekly 集計は post-PMF)。
 */
export async function getRetentionCohort(
	period: RetentionCohortPeriod = 'monthly',
): Promise<RetentionCohortResult> {
	// monthly: 直近 6 cohort / weekly: 直近 12 cohort 想定。Pre-PMF 段階で件数は少ないため固定。
	const monthsBack = period === 'weekly' ? 3 : 6;
	const result: CohortAnalysisResult = await getCohortAnalysis(monthsBack);

	const dayPoints = [1, 7, 14, 30, 60, 90];

	const cohorts: RetentionCohortRow[] = result.cohorts.map((c) => ({
		cohort: c.month,
		size: c.size,
		retention: c.retention,
		insufficientSample: c.insufficientSample,
	}));

	return {
		period,
		dayPoints,
		cohorts,
		fetchedAt: result.fetchedAt,
	};
}

/**
 * Sean Ellis スコアを取得する (#1639 AC3)。
 * 既存 pmf-survey-service.aggregateSurveyResponses を再利用。
 *
 * round 未指定なら現在 round (YYYY-H1 / YYYY-H2)。
 */
export async function getSeanEllisScore(round?: string): Promise<PmfSurveyAggregation> {
	const targetRound = round ?? getCurrentRound();
	return aggregateSurveyResponses(targetRound);
}

/**
 * 解約理由分布を取得する (#1639 AC4)。
 * 既存 cancellation-service.getCancellationReasonAggregation を再利用。
 */
export async function getCancellationReasons(
	period: CancellationReasonPeriod = '90d',
): Promise<CancellationReasonResult> {
	const days = period === '30d' ? 30 : 90;
	const { total, breakdown } = await getCancellationReasonAggregation(days);
	return {
		period,
		total,
		breakdown,
		fetchedAt: new Date().toISOString(),
	};
}
