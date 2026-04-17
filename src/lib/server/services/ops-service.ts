// src/lib/server/services/ops-service.ts
// 運営管理ダッシュボード: テナントKPI集計サービス (#0176)

import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { getStripeClient, isStripeEnabled } from '$lib/server/stripe/client';

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
		familyMonthly: number;
		familyYearly: number;
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
		active: tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.ACTIVE).length,
		gracePeriod: tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.GRACE_PERIOD).length,
		suspended: tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.SUSPENDED).length,
		terminated: tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.TERMINATED).length,
		planBreakdown: countPlans(tenants),
		newThisMonth: tenants.filter((t) => new Date(t.createdAt) >= monthStart).length,
	};
}

function countPlans(tenants: Tenant[]) {
	const activeTenants = tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.ACTIVE);
	return {
		monthly: activeTenants.filter((t) => t.plan === LICENSE_PLAN.MONTHLY).length,
		yearly: activeTenants.filter((t) => t.plan === LICENSE_PLAN.YEARLY).length,
		familyMonthly: activeTenants.filter((t) => t.plan === LICENSE_PLAN.FAMILY_MONTHLY).length,
		familyYearly: activeTenants.filter((t) => t.plan === LICENSE_PLAN.FAMILY_YEARLY).length,
		lifetime: activeTenants.filter((t) => t.plan === LICENSE_PLAN.LIFETIME).length,
		noPlan: activeTenants.filter((t) => !t.plan).length,
	};
}

// ============================================================
// Revenue (Stripe)
// ============================================================

export interface InvoiceRow {
	id: string;
	customerId: string;
	customerEmail: string;
	amount: number;
	stripeFee: number;
	paidAt: string;
	planDescription: string;
}

export interface MonthlyRevenue {
	month: string; // YYYY-MM
	revenue: number;
	invoiceCount: number;
	stripeFees: number;
}

export interface RevenueData {
	invoices: InvoiceRow[];
	totalRevenue: number;
	totalStripeFees: number;
	monthlyBreakdown: MonthlyRevenue[];
	mrr: number;
	arr: number;
}

/**
 * Stripe 収益データを取得（指定期間の paid 請求書）
 */
export async function getRevenueData(from: Date, to: Date): Promise<RevenueData> {
	if (!isStripeEnabled()) {
		return emptyRevenueData();
	}

	try {
		const stripe = getStripeClient();
		const invoices = await stripe.invoices.list({
			status: 'paid',
			created: {
				gte: Math.floor(from.getTime() / 1000),
				lte: Math.floor(to.getTime() / 1000),
			},
			limit: 100,
		});

		const rows: InvoiceRow[] = invoices.data.map((inv) => {
			// Stripe手数料: 概算（日本: 3.6% + ¥40/件）
			const stripeFee = Math.round(inv.amount_paid * 0.036 + 40);

			return {
				id: inv.id,
				customerId: (inv.customer as string) ?? '',
				customerEmail: inv.customer_email ?? '',
				amount: inv.amount_paid,
				stripeFee,
				paidAt: inv.status_transitions?.paid_at
					? new Date(inv.status_transitions.paid_at * 1000).toISOString()
					: '',
				planDescription: inv.lines?.data?.[0]?.description ?? '',
			};
		});

		const totalRevenue = rows.reduce((sum, r) => sum + r.amount, 0);
		const totalStripeFees = rows.reduce((sum, r) => sum + r.stripeFee, 0);

		// 月次集計
		const monthMap = new Map<string, MonthlyRevenue>();
		for (const row of rows) {
			if (!row.paidAt) continue;
			const month = row.paidAt.slice(0, 7); // YYYY-MM
			const existing = monthMap.get(month) ?? { month, revenue: 0, invoiceCount: 0, stripeFees: 0 };
			existing.revenue += row.amount;
			existing.invoiceCount += 1;
			existing.stripeFees += row.stripeFee;
			monthMap.set(month, existing);
		}
		const monthlyBreakdown = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

		// MRR/ARR: KPI のプラン内訳ベース（Stripe請求ベースでなく、DB のテナント情報から算出）
		const tenantStats = await getTenantStats();
		const mrr =
			tenantStats.planBreakdown.monthly * 500 +
			Math.round((tenantStats.planBreakdown.yearly * 5000) / 12) +
			tenantStats.planBreakdown.familyMonthly * 780 +
			Math.round((tenantStats.planBreakdown.familyYearly * 7800) / 12);
		const arr = mrr * 12;

		return { invoices: rows, totalRevenue, totalStripeFees, monthlyBreakdown, mrr, arr };
	} catch (e) {
		logger.error('[OPS] Failed to fetch Stripe revenue data', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return emptyRevenueData();
	}
}

function emptyRevenueData(): RevenueData {
	return {
		invoices: [],
		totalRevenue: 0,
		totalStripeFees: 0,
		monthlyBreakdown: [],
		mrr: 0,
		arr: 0,
	};
}

// ============================================================
// AWS Costs
// ============================================================

export interface ServiceCost {
	service: string;
	amount: number;
	unit: string;
}

export interface AWSCostData {
	month: string;
	services: ServiceCost[];
	total: number;
	fetchedAt: string;
}

// メモリキャッシュ（Lambda warm instance 内で1日保持）
let _costCache: { key: string; data: AWSCostData; fetchedAt: number } | null = null;
const COST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

/**
 * AWS Cost Explorer から当月の費用データを取得（1日キャッシュ）
 */
export async function getAWSCostData(year: number, month: number): Promise<AWSCostData> {
	const cacheKey = `${year}-${String(month).padStart(2, '0')}`;

	if (
		_costCache &&
		_costCache.key === cacheKey &&
		Date.now() - _costCache.fetchedAt < COST_CACHE_TTL_MS
	) {
		return _costCache.data;
	}

	try {
		const { CostExplorerClient, GetCostAndUsageCommand } = await import(
			'@aws-sdk/client-cost-explorer'
		);

		const client = new CostExplorerClient({ region: 'us-east-1' });
		const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
		const nextMonth =
			month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

		const result = await client.send(
			new GetCostAndUsageCommand({
				TimePeriod: { Start: startDate, End: nextMonth },
				Granularity: 'MONTHLY',
				GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
				Metrics: ['UnblendedCost'],
			}),
		);

		const services: ServiceCost[] =
			result.ResultsByTime?.[0]?.Groups?.filter((g) => {
				const amt = Number.parseFloat(g.Metrics?.UnblendedCost?.Amount ?? '0');
				return amt > 0;
			}).map((g) => ({
				service: g.Keys?.[0] ?? 'Unknown',
				amount: Number.parseFloat(g.Metrics?.UnblendedCost?.Amount ?? '0'),
				unit: g.Metrics?.UnblendedCost?.Unit ?? 'USD',
			})) ?? [];

		services.sort((a, b) => b.amount - a.amount);

		const total = services.reduce((sum, s) => sum + s.amount, 0);
		const data: AWSCostData = {
			month: cacheKey,
			services,
			total,
			fetchedAt: new Date().toISOString(),
		};

		_costCache = { key: cacheKey, data, fetchedAt: Date.now() };
		return data;
	} catch (e) {
		logger.error('[OPS] Failed to fetch AWS cost data', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return {
			month: cacheKey,
			services: [],
			total: 0,
			fetchedAt: new Date().toISOString(),
		};
	}
}

// ============================================================
// CSV Export
// ============================================================

/**
 * 売上台帳CSV（青色申告用）
 */
export function generateSalesLedgerCsv(invoices: InvoiceRow[]): string {
	const header = '取引日,顧客ID（匿名化）,摘要,金額(税込),消費税,金額(税抜),備考';
	const rows = invoices.map((inv) => {
		const date = inv.paidAt ? inv.paidAt.slice(0, 10) : '';
		const custId = `${inv.customerId.slice(0, 12)}...`;
		return `${date},${custId},${inv.planDescription},${inv.amount},0,${inv.amount},Stripe ${inv.id}`;
	});
	return [header, ...rows].join('\n');
}

/**
 * 経費台帳CSV（青色申告用）
 */
export function generateExpenseLedgerCsv(
	costs: AWSCostData,
	stripeFees: number,
	month: string,
): string {
	const header = '取引日,勘定科目,摘要,金額(税込),消費税率,金額(税抜),支払先';
	const lastDay = `${month}-28`; // 月末概算
	const rows: string[] = [];

	// AWS 各サービス
	for (const svc of costs.services) {
		const jpy = Math.round(svc.amount * 150); // USD→JPY概算
		const taxExcl = Math.round(jpy / 1.1);
		rows.push(
			`${lastDay},通信費,${svc.service}（${month}分）,${jpy},10%,${taxExcl},Amazon Web Services`,
		);
	}

	// Stripe 手数料
	if (stripeFees > 0) {
		const taxExcl = Math.round(stripeFees / 1.1);
		rows.push(
			`${lastDay},支払手数料,Stripe決済手数料（${month}分）,${stripeFees},10%,${taxExcl},Stripe Inc.`,
		);
	}

	return [header, ...rows].join('\n');
}

/**
 * 収支サマリーテキスト
 */
export function generatePLSummary(revenue: RevenueData, costs: AWSCostData): string {
	const awsTotalJpy = Math.round(costs.total * 150);
	const profit = revenue.totalRevenue - revenue.totalStripeFees - awsTotalJpy;

	return [
		`【${costs.month} 事業収支サマリー】 がんばりクエスト`,
		'',
		'■ 収入の部',
		`  サービス売上（サブスクリプション）  ¥${revenue.totalRevenue.toLocaleString()}`,
		'  ─────────────────────────────',
		`  売上合計                          ¥${revenue.totalRevenue.toLocaleString()}`,
		'',
		'■ 経費の部',
		`  通信費（AWS）                     ¥${awsTotalJpy.toLocaleString()}`,
		`  支払手数料（Stripe）                ¥${revenue.totalStripeFees.toLocaleString()}`,
		'  ─────────────────────────────',
		`  経費合計                          ¥${(revenue.totalStripeFees + awsTotalJpy).toLocaleString()}`,
		'',
		`■ 差引利益（事業所得概算）            ¥${profit.toLocaleString()}`,
		'  ※ 青色申告特別控除（65万円/55万円/10万円）は別途適用',
		'  ※ 本サマリーは概算値です。正式な申告は税理士または e-Tax で確認ください。',
	].join('\n');
}
