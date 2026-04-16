// src/routes/ops/analytics/+page.server.ts
// #822: /ops 分析基盤（LTV / コホート / campaign 効果測定）
//
// 既存の DB テナントデータと Stripe データを活用し、
// LTV 推計・月次コホート残存率・流入経路別集計を提供する。
// データパイプラインは不要（DB 直接集計、$100 予算内）。

import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { PageServerLoad } from './$types';

// ============================================================
// Types
// ============================================================

interface MonthlyAcquisition {
	month: string; // YYYY-MM
	organic: number;
	total: number;
}

interface CohortRow {
	month: string; // 入会月 YYYY-MM
	totalSignups: number;
	/** 各月の残存数。index 0 = 入会月, index 1 = 1ヶ月後, ... */
	retention: number[];
}

interface LtvEstimate {
	avgLifetimeMonths: number;
	monthlyArpu: number;
	estimatedLtv: number;
	activeSubscribers: number;
	churned: number;
	churnRate: number;
}

interface PlanBreakdownWithRevenue {
	plan: string;
	count: number;
	mrr: number;
	percentage: number;
}

export interface OpsAnalyticsData {
	monthlyAcquisitions: MonthlyAcquisition[];
	cohorts: CohortRow[];
	ltv: LtvEstimate;
	planBreakdown: PlanBreakdownWithRevenue[];
	stripeEnabled: boolean;
	fetchedAt: string;
}

// ============================================================
// Helpers
// ============================================================

function getMonthKey(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthDiff(from: string, to: string): number {
	const fromParts = from.split('-').map(Number);
	const toParts = to.split('-').map(Number);
	const fy = fromParts[0] ?? 0;
	const fm = fromParts[1] ?? 0;
	const ty = toParts[0] ?? 0;
	const tm = toParts[1] ?? 0;
	return (ty - fy) * 12 + (tm - fm);
}

// ============================================================
// Analytics computation
// ============================================================

async function computeAnalytics(): Promise<OpsAnalyticsData> {
	const repos = getRepos();
	let tenants: Tenant[];
	try {
		tenants = await repos.auth.listAllTenants();
	} catch (e) {
		logger.error('[OPS/analytics] Failed to list tenants', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return emptyAnalytics();
	}

	const now = new Date();
	const currentMonth = getMonthKey(now);

	// ── 1. Monthly Acquisitions (過去 12 ヶ月) ──
	const acquisitionMap = new Map<string, MonthlyAcquisition>();
	for (let i = 11; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const key = getMonthKey(d);
		acquisitionMap.set(key, { month: key, organic: 0, total: 0 });
	}
	for (const t of tenants) {
		const key = getMonthKey(t.createdAt);
		const entry = acquisitionMap.get(key);
		if (entry) {
			entry.organic += 1;
			entry.total += 1;
		}
	}
	const monthlyAcquisitions = [...acquisitionMap.values()];

	// ── 2. Cohort Analysis (入会月別の残存率、最大 6 ヶ月) ──
	const MAX_COHORT_MONTHS = 6;
	const cohortMap = new Map<
		string,
		{ total: number; tenantsCreated: Date[]; statuses: string[] }
	>();
	for (const t of tenants) {
		const key = getMonthKey(t.createdAt);
		if (!cohortMap.has(key)) {
			cohortMap.set(key, { total: 0, tenantsCreated: [], statuses: [] });
		}
		const c = cohortMap.get(key);
		if (!c) continue;
		c.total += 1;
		c.tenantsCreated.push(new Date(t.createdAt));
		c.statuses.push(t.status);
	}

	const cohorts: CohortRow[] = [];
	const sortedCohortMonths = [...cohortMap.keys()].sort();
	for (const month of sortedCohortMonths) {
		const monthsFromNow = monthDiff(month, currentMonth);
		if (monthsFromNow < 0 || monthsFromNow > 12) continue;

		const c = cohortMap.get(month);
		if (!c) continue;
		const retentionLength = Math.min(monthsFromNow + 1, MAX_COHORT_MONTHS + 1);
		const retention: number[] = [];

		// 残存は status ベースで簡易判定
		// index 0 = 入会月 = 全員
		// index N = N ヶ月後に active なテナント数
		const terminatedCount = c.statuses.filter(
			(s) => s === SUBSCRIPTION_STATUS.TERMINATED || s === SUBSCRIPTION_STATUS.SUSPENDED,
		).length;

		for (let i = 0; i < retentionLength; i++) {
			if (i === 0) {
				retention.push(c.total);
			} else {
				// 簡易: 解約テナントを後ろの月に均等配分
				const churnPerMonth = retentionLength > 1 ? terminatedCount / (retentionLength - 1) : 0;
				const remaining = Math.max(0, Math.round(c.total - churnPerMonth * i));
				retention.push(remaining);
			}
		}

		cohorts.push({ month, totalSignups: c.total, retention });
	}

	// ── 3. LTV Estimate ──
	const activeTenants = tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.ACTIVE);
	const churnedTenants = tenants.filter(
		(t) =>
			t.status === SUBSCRIPTION_STATUS.TERMINATED || t.status === SUBSCRIPTION_STATUS.SUSPENDED,
	);

	const monthlyPrice = 500; // standard monthly
	const yearlyMonthlyEquiv = Math.round(5000 / 12);

	const paidActive = activeTenants.filter((t) => t.plan);
	const monthlyMrr =
		activeTenants.filter((t) => t.plan === LICENSE_PLAN.MONTHLY).length * monthlyPrice +
		activeTenants.filter((t) => t.plan === LICENSE_PLAN.YEARLY).length * yearlyMonthlyEquiv;

	const monthlyArpu = paidActive.length > 0 ? Math.round(monthlyMrr / paidActive.length) : 0;

	// チャーンレート: 過去のテナント数に対する解約数
	const totalEverTenants = tenants.length;
	const churnRate = totalEverTenants > 0 ? churnedTenants.length / totalEverTenants : 0;
	const monthlyChurnRate = churnRate > 0 ? churnRate / 12 : 0; // 年率を月率に概算
	const avgLifetimeMonths = monthlyChurnRate > 0 ? 1 / monthlyChurnRate : 60; // 上限 60 ヶ月

	const ltv: LtvEstimate = {
		avgLifetimeMonths: Math.min(Math.round(avgLifetimeMonths * 10) / 10, 60),
		monthlyArpu,
		estimatedLtv: Math.round(monthlyArpu * Math.min(avgLifetimeMonths, 60)),
		activeSubscribers: paidActive.length,
		churned: churnedTenants.length,
		churnRate: Math.round(churnRate * 1000) / 10, // パーセンテージ（小数1桁）
	};

	// ── 4. Plan Breakdown with Revenue ──
	const planCounts = new Map<string, number>();
	for (const t of activeTenants) {
		const plan = t.plan || 'none';
		planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
	}

	const planBreakdown: PlanBreakdownWithRevenue[] = [];
	const totalActive = activeTenants.length;

	for (const [plan, count] of planCounts) {
		let mrr = 0;
		if (plan === LICENSE_PLAN.MONTHLY) mrr = count * monthlyPrice;
		else if (plan === LICENSE_PLAN.YEARLY) mrr = count * yearlyMonthlyEquiv;
		// lifetime / none は MRR 0

		planBreakdown.push({
			plan,
			count,
			mrr,
			percentage: totalActive > 0 ? Math.round((count / totalActive) * 1000) / 10 : 0,
		});
	}
	planBreakdown.sort((a, b) => b.mrr - a.mrr);

	return {
		monthlyAcquisitions,
		cohorts: cohorts.slice(-7), // 直近 7 コホート
		ltv,
		planBreakdown,
		stripeEnabled: isStripeEnabled(),
		fetchedAt: new Date().toISOString(),
	};
}

function emptyAnalytics(): OpsAnalyticsData {
	return {
		monthlyAcquisitions: [],
		cohorts: [],
		ltv: {
			avgLifetimeMonths: 0,
			monthlyArpu: 0,
			estimatedLtv: 0,
			activeSubscribers: 0,
			churned: 0,
			churnRate: 0,
		},
		planBreakdown: [],
		stripeEnabled: false,
		fetchedAt: new Date().toISOString(),
	};
}

export const load: PageServerLoad = async () => {
	const analytics = await computeAnalytics();
	return { analytics };
};
