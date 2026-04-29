// src/routes/(parent)/admin/analytics/+page.server.ts
// #1639 (#1591 follow-up): /admin/analytics に DynamoDB ベース 4 種可視化を実装。
//
// Pre-PMF (ADR-0010): 事前集計レコードは未導入。直接 query で十分（~100 テナント想定）。
// 集計頻度が高くなれば cron で `PK=ANALYTICS_AGG#<date>` を書く設計に移行する (follow-up Issue)。
//
// Query parameters:
//   funnelPeriod: 7d / 30d (default: 30d)
//   cohortPeriod: weekly / monthly (default: monthly)
//   cancelPeriod: 30d / 90d (default: 90d)
//   round: YYYY-H1 / YYYY-H2 (default: 現在 round) — Sean Ellis 用

import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import {
	type ActivationFunnelPeriod,
	type ActivationFunnelResult,
	type CancellationReasonPeriod,
	type CancellationReasonResult,
	getActivationFunnel,
	getCancellationReasons,
	getRetentionCohort,
	getSeanEllisScore,
	type RetentionCohortPeriod,
	type RetentionCohortResult,
} from '$lib/server/services/analytics-service';
import {
	getCurrentRound,
	type PmfSurveyAggregation,
} from '$lib/server/services/pmf-survey-service';
import type { PageServerLoad } from './$types';

interface AdminAnalyticsLoadResult {
	funnel: ActivationFunnelResult | null;
	cohort: RetentionCohortResult | null;
	seanEllis: PmfSurveyAggregation | null;
	cancellation: CancellationReasonResult | null;
	funnelPeriod: ActivationFunnelPeriod;
	cohortPeriod: RetentionCohortPeriod;
	cancelPeriod: CancellationReasonPeriod;
	round: string;
	errors: {
		funnel: string | null;
		cohort: string | null;
		seanEllis: string | null;
		cancellation: string | null;
	};
}

function parseFunnelPeriod(value: string | null): ActivationFunnelPeriod {
	return value === '7d' ? '7d' : '30d';
}

function parseCohortPeriod(value: string | null): RetentionCohortPeriod {
	return value === 'weekly' ? 'weekly' : 'monthly';
}

function parseCancelPeriod(value: string | null): CancellationReasonPeriod {
	return value === '30d' ? '30d' : '90d';
}

function parseRound(value: string | null): string {
	return value && /^\d{4}-H[12]$/.test(value) ? value : getCurrentRound();
}

export const load: PageServerLoad = async ({ locals, url }): Promise<AdminAnalyticsLoadResult> => {
	requireTenantId(locals);

	const funnelPeriod = parseFunnelPeriod(url.searchParams.get('funnelPeriod'));
	const cohortPeriod = parseCohortPeriod(url.searchParams.get('cohortPeriod'));
	const cancelPeriod = parseCancelPeriod(url.searchParams.get('cancelPeriod'));
	const round = parseRound(url.searchParams.get('round'));

	// 4 つの集計関数を並列取得。1 つが失敗しても他は表示する (Pre-PMF: 部分縮退許容)。
	const [funnelResult, cohortResult, seanEllisResult, cancellationResult] =
		await Promise.allSettled([
			getActivationFunnel(funnelPeriod),
			getRetentionCohort(cohortPeriod),
			getSeanEllisScore(round),
			getCancellationReasons(cancelPeriod),
		]);

	function unwrap<T>(
		settled: PromiseSettledResult<T>,
		label: string,
	): { value: T | null; error: string | null } {
		if (settled.status === 'fulfilled') {
			return { value: settled.value, error: null };
		}
		const message =
			settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
		logger.warn(`[admin-analytics] ${label} failed`, { context: { error: message } });
		return { value: null, error: message };
	}

	const funnel = unwrap(funnelResult, 'activation funnel');
	const cohort = unwrap(cohortResult, 'retention cohort');
	const seanEllis = unwrap(seanEllisResult, 'sean ellis');
	const cancellation = unwrap(cancellationResult, 'cancellation reasons');

	return {
		funnel: funnel.value,
		cohort: cohort.value,
		seanEllis: seanEllis.value,
		cancellation: cancellation.value,
		funnelPeriod,
		cohortPeriod,
		cancelPeriod,
		round,
		errors: {
			funnel: funnel.error,
			cohort: cohort.error,
			seanEllis: seanEllis.error,
			cancellation: cancellation.error,
		},
	};
};
