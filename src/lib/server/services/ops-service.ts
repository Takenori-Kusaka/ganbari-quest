// src/lib/server/services/ops-service.ts
// 運営管理ダッシュボード: テナントKPI集計サービス (#0176)

import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { isStripeEnabled } from '$lib/server/stripe/client';

// ============================================================
// Types
// ============================================================

export interface TenantStats {
	total: number;
	active: number;
	gracePeriod: number;
	suspended: number;
	terminated: number;
	planBreakdown: {
		monthly: number;
		yearly: number;
		lifetime: number;
		noPlan: number;
	};
	newThisMonth: number;
}

export interface OpsKpiSummary {
	tenantStats: TenantStats;
	activeRate: number;
	stripeEnabled: boolean;
	fetchedAt: string;
}

// ============================================================
// Service
// ============================================================

/**
 * 全テナントの KPI サマリーを取得
 */
export async function getKpiSummary(): Promise<OpsKpiSummary> {
	const tenantStats = await getTenantStats();
	const activeRate = tenantStats.total > 0 ? tenantStats.active / tenantStats.total : 0;

	return {
		tenantStats,
		activeRate,
		stripeEnabled: isStripeEnabled(),
		fetchedAt: new Date().toISOString(),
	};
}

/**
 * テナント統計を集計
 */
async function getTenantStats(): Promise<TenantStats> {
	const repos = getRepos();
	const tenants = await repos.auth.listAllTenants();

	const now = new Date();
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

	return {
		total: tenants.length,
		active: tenants.filter((t) => t.status === 'active').length,
		gracePeriod: tenants.filter((t) => t.status === 'grace_period').length,
		suspended: tenants.filter((t) => t.status === 'suspended').length,
		terminated: tenants.filter((t) => t.status === 'terminated').length,
		planBreakdown: countPlans(tenants),
		newThisMonth: tenants.filter((t) => new Date(t.createdAt) >= monthStart).length,
	};
}

function countPlans(tenants: Tenant[]) {
	const activeTenants = tenants.filter((t) => t.status === 'active');
	return {
		monthly: activeTenants.filter((t) => t.plan === 'monthly').length,
		yearly: activeTenants.filter((t) => t.plan === 'yearly').length,
		lifetime: activeTenants.filter((t) => t.plan === 'lifetime').length,
		noPlan: activeTenants.filter((t) => !t.plan).length,
	};
}
