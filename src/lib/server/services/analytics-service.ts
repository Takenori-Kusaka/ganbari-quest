// src/lib/server/services/analytics-service.ts
// Analytics service — server-side event tracking facade.
// Wraps the analytics module with app-specific business event helpers.
//
// #1639 (#1591 follow-up): /admin/analytics 可視化用の集計関数を追加
// (activation funnel / cancellation reasons / Sean Ellis スコア / retention cohort)。
//
// #1693 (#1639 follow-up): 「集計レコード優先 → ライブ計算 fallback」構造を導入。
// EventBridge cron `gq-analytics-aggregator-daily` (03:00 JST) が前日分を
// `PK=ANALYTICS_AGG#<YYYY-MM-DD>` に書き込み、本ファイルの read 関数が期間内日付の
// レコードを取得して合算する。事前集計が無い日付分のみ従来のライブ query を実行する。

import { analytics } from '$lib/analytics';
import {
	ANALYTICS_AGG_KIND,
	type CancellationDailyAggregate,
	type FunnelDailyAggregate,
	queryAnalyticsAggregates,
	queryAnalyticsEventTenantList,
} from '$lib/analytics/providers/dynamo';
import type { BusinessEventName, EventProperties } from '$lib/analytics/types';
import type { CancellationReasonAggregation } from '$lib/server/db/interfaces/cancellation-reason-repo.interface';
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

/** Retention cohort period granularity */
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
 * `YYYY-MM-DD` 文字列の今日 (UTC) との days 前を返す。
 */
function isoDateDaysAgo(daysAgo: number): string {
	return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Activation funnel を取得する (#1639 AC1 / #1693 follow-up)。
 * 4 step (signup / first_child / first_activity / first_reward) のテナント単位 unique 件数。
 *
 * #1693 集計レコード優先 → ライブ計算 fallback:
 *   1. cron 事前集計レコード (`ANALYTICS_AGG#<date> SK=FUNNEL`) を期間内 (前日まで) 取得
 *   2. 各日付の tenantsByEvent から union を取り unique 件数を合算
 *   3. 当日分など集計レコードが無い日付については `queryAnalyticsEventTenants` で
 *      個別ライブ計算し、結果を集計レコードと merge する
 *
 * Pre-PMF / ADR-0010: tenant 数が ~100 規模なので tenantId 一覧を持つ「正確な union」
 * 方式を採用。Post-PMF で件数が増えたら HyperLogLog 近似に切替検討 (follow-up)。
 */
export async function getActivationFunnel(
	period: ActivationFunnelPeriod = '30d',
): Promise<ActivationFunnelResult> {
	const days = period === '7d' ? 7 : 30;
	const sinceDate = isoDateDaysAgo(days);
	const yesterday = isoDateDaysAgo(1);
	const today = isoDateDaysAgo(0);

	// 1. 集計レコードを取得 (前日までの範囲)
	const aggregates = (await queryAnalyticsAggregates(
		ANALYTICS_AGG_KIND.FUNNEL,
		sinceDate,
		yesterday,
	)) as FunnelDailyAggregate[];

	const aggregatedDates = new Set<string>();
	const tenantsByEventUnion: Record<string, Set<string>> = {};
	for (const eventName of ACTIVATION_FUNNEL_EVENT_NAMES) {
		tenantsByEventUnion[eventName] = new Set<string>();
	}
	for (const agg of aggregates) {
		aggregatedDates.add(agg.date);
		for (const eventName of ACTIVATION_FUNNEL_EVENT_NAMES) {
			const tenants = agg.tenantsByEvent?.[eventName] ?? [];
			for (const t of tenants) tenantsByEventUnion[eventName]?.add(t);
		}
	}

	// 2. 集計レコードが無い日付 (= 当日 / 期間内に cron 未実行な日) をライブで補う。
	// Pre-PMF: ライブ補完対象は事実上「当日」のみ (cron が前日分を毎晩書く前提)。
	// ただし cron 失敗で歯抜けになっても fallback で全期間を query する保険を入れる:
	// 集計済み日付が「期間内 N 日 (前日まで N-1 日 + 当日)」を 1 件でも欠いていたら、
	// 期間全体をライブ計算してから aggregate と union する。
	const expectedAggregatedDays = days; // since から前日まで
	let liveScannedDates = 0;
	const aggregateMissed = aggregatedDates.size < expectedAggregatedDays;
	const liveSinceDate = aggregateMissed || aggregates.length === 0 ? sinceDate : today;
	for (const eventName of ACTIVATION_FUNNEL_EVENT_NAMES) {
		const { tenants, scannedDates } = await queryAnalyticsEventTenantList(eventName, liveSinceDate);
		const set = tenantsByEventUnion[eventName] ?? new Set<string>();
		for (const t of tenants) set.add(t);
		tenantsByEventUnion[eventName] = set;
		liveScannedDates = Math.max(liveScannedDates, scannedDates);
	}

	const counts: number[] = ACTIVATION_FUNNEL_EVENT_NAMES.map(
		(eventName) => tenantsByEventUnion[eventName]?.size ?? 0,
	);

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

	const scannedDates = Math.max(aggregatedDates.size, liveScannedDates);

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
 * 解約理由分布を取得する (#1639 AC4 / #1693 follow-up)。
 *
 * #1693 集計レコード優先 → ライブ計算 fallback:
 *   1. 前日付の集計レコード `ANALYTICS_AGG#<yesterday> SK=CANCELLATION_<period>` を取得
 *   2. 取れた場合: そのスナップショットを採用 (cron が毎日 30d / 90d window を再計算済)
 *   3. 取れなかった場合: 既存ライブ計算 `getCancellationReasonAggregation(days)` で fallback
 *
 * cron `gq-analytics-aggregator-daily` (#1693) が毎日 30d / 90d 双方を 1 レコードずつ
 * 書き込むため、cron 成功している限り read 側は DynamoDB 1 PutItem 分の rolling-window
 * スナップショットを直接読むだけで済む (Pre-PMF: 解約集計のスキャンコスト削減)。
 */
export async function getCancellationReasons(
	period: CancellationReasonPeriod = '90d',
): Promise<CancellationReasonResult> {
	const days = period === '30d' ? 30 : 90;
	const yesterday = isoDateDaysAgo(1);
	const kind =
		period === '30d' ? ANALYTICS_AGG_KIND.CANCELLATION_30D : ANALYTICS_AGG_KIND.CANCELLATION_90D;

	// 1. 集計レコード優先 (前日分の rolling-window スナップショット)
	const aggregates = (await queryAnalyticsAggregates(
		kind,
		yesterday,
		yesterday,
	)) as CancellationDailyAggregate[];

	if (aggregates.length > 0 && aggregates[0]) {
		const agg = aggregates[0];
		const breakdown = agg.breakdown.map((b) => ({
			category: b.category as CancellationReasonAggregation['category'],
			count: b.count,
			percentage: agg.total > 0 ? (b.count / agg.total) * 100 : 0,
		}));
		return {
			period,
			total: agg.total,
			breakdown,
			fetchedAt: new Date().toISOString(),
		};
	}

	// 2. fallback: 従来のライブ集計
	const { total, breakdown } = await getCancellationReasonAggregation(days);
	return {
		period,
		total,
		breakdown,
		fetchedAt: new Date().toISOString(),
	};
}
