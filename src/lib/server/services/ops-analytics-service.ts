// src/lib/server/services/ops-analytics-service.ts
// #822: OPS 分析サービス — LTV / コホート / MRR 内訳
//
// +page.server.ts からビジネスロジックを抽出（アーキテクチャ規約準拠）。

import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { isStripeEnabled } from '$lib/server/stripe/client';

// ============================================================
// Types
// ============================================================

export interface MonthlyAcquisition {
	month: string; // YYYY-MM
	organic: number;
	total: number;
}

export interface CohortRow {
	month: string; // YYYY-MM
	totalSignups: number;
	retention: number[];
}

export interface LtvEstimate {
	avgLifetimeMonths: number;
	monthlyArpu: number;
	estimatedLtv: number;
	activeSubscribers: number;
	churned: number;
	churnRate: number;
}

export interface PlanBreakdownWithRevenue {
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
// Price map (JPY)
// ============================================================

/** プラン別 MRR 単価 (monthly 換算) */
const PLAN_MRR_UNIT: Record<string, number> = {
	[LICENSE_PLAN.MONTHLY]: 500,
	[LICENSE_PLAN.YEARLY]: Math.round(5000 / 12),
	[LICENSE_PLAN.FAMILY_MONTHLY]: 780,
	[LICENSE_PLAN.FAMILY_YEARLY]: Math.round(7800 / 12),
};

// ============================================================
// Helpers (exported for tests)
// ============================================================

export function getMonthKey(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthDiff(from: string, to: string): number {
	const fromParts = from.split('-').map(Number);
	const toParts = to.split('-').map(Number);
	const fy = fromParts[0] ?? 0;
	const fm = fromParts[1] ?? 0;
	const ty = toParts[0] ?? 0;
	const tm = toParts[1] ?? 0;
	return (ty - fy) * 12 + (tm - fm);
}

// ============================================================
// Core computation (pure function — テスト容易)
// ============================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コード、別Issueで対応予定
export function computeAnalytics(
	tenants: Tenant[],
	now?: Date,
): Omit<OpsAnalyticsData, 'stripeEnabled' | 'fetchedAt'> {
	const currentDate = now ?? new Date();
	const currentMonth = getMonthKey(currentDate);

	// ── 1. Monthly Acquisitions (過去 12 ヶ月) ──
	const acquisitionMap = new Map<string, MonthlyAcquisition>();
	for (let i = 11; i >= 0; i--) {
		const d = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
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
	const cohortMap = new Map<string, { total: number; statuses: string[] }>();
	for (const t of tenants) {
		const key = getMonthKey(t.createdAt);
		if (!cohortMap.has(key)) {
			cohortMap.set(key, { total: 0, statuses: [] });
		}
		const c = cohortMap.get(key);
		if (!c) continue;
		c.total += 1;
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

		const terminatedCount = c.statuses.filter(
			(s) => s === SUBSCRIPTION_STATUS.TERMINATED || s === SUBSCRIPTION_STATUS.SUSPENDED,
		).length;

		for (let i = 0; i < retentionLength; i++) {
			if (i === 0) {
				retention.push(c.total);
			} else {
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

	const paidActive = activeTenants.filter((t) => t.plan);

	// MRR: 全プラン対応 (family-monthly / family-yearly 含む)
	let monthlyMrr = 0;
	for (const t of activeTenants) {
		if (t.plan) {
			monthlyMrr += PLAN_MRR_UNIT[t.plan] ?? 0;
		}
	}

	const monthlyArpu = paidActive.length > 0 ? Math.round(monthlyMrr / paidActive.length) : 0;

	const totalEverTenants = tenants.length;
	const churnRate = totalEverTenants > 0 ? churnedTenants.length / totalEverTenants : 0;
	const monthlyChurnRate = churnRate > 0 ? churnRate / 12 : 0;
	const avgLifetimeMonths = monthlyChurnRate > 0 ? 1 / monthlyChurnRate : 60;

	const ltv: LtvEstimate = {
		avgLifetimeMonths: Math.min(Math.round(avgLifetimeMonths * 10) / 10, 60),
		monthlyArpu,
		estimatedLtv: Math.round(monthlyArpu * Math.min(avgLifetimeMonths, 60)),
		activeSubscribers: paidActive.length,
		churned: churnedTenants.length,
		churnRate: Math.round(churnRate * 1000) / 10,
	};

	// ── 4. Plan Breakdown with Revenue (全プラン対応) ──
	const planCounts = new Map<string, number>();
	for (const t of activeTenants) {
		const plan = t.plan || 'none';
		planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
	}

	const planBreakdown: PlanBreakdownWithRevenue[] = [];
	const totalActive = activeTenants.length;

	for (const [plan, count] of planCounts) {
		const mrr = (PLAN_MRR_UNIT[plan] ?? 0) * count;

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
		cohorts: cohorts.slice(-7),
		ltv,
		planBreakdown,
	};
}

// ============================================================
// Public API
// ============================================================

export function emptyAnalytics(): OpsAnalyticsData {
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

export async function getAnalyticsData(): Promise<OpsAnalyticsData> {
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

	const result = computeAnalytics(tenants);

	return {
		...result,
		stripeEnabled: isStripeEnabled(),
		fetchedAt: new Date().toISOString(),
	};
}
