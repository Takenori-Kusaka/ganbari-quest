// src/lib/server/services/stripe-metrics-service.ts
// Stripe 収益指標自動取得サービス (#835)
//
// MRR / ARR / ARPU / 有料数 / トライアル→有料転換率 / 月次解約率 を提供。
// 12-事業計画書.md §7.2 / 19-プライシング戦略書.md §8.1 の KPI 定義に準拠。

import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { getStripeClient, isStripeEnabled } from '$lib/server/stripe/client';
import { getPlans, type PlanConfig, type PlanId } from '$lib/server/stripe/config';

// ============================================================
// Types
// ============================================================

export interface StripeMetrics {
	/** 月次経常収益 (JPY) */
	mrr: number;
	/** 年次経常収益 (JPY) */
	arr: number;
	/** ユーザーあたり平均収益 (JPY) */
	arpu: number;
	/** アクティブ有料サブスク数 */
	activePaidCount: number;
	/** トライアル→有料転換率 (0-1) */
	trialToActiveRate: number;
	/** 月次解約率 (0-1) */
	monthlyChurnRate: number;
	/** 当月売上 (JPY, Stripe手数料差引前) */
	monthlyRevenue: number;
	/** 取得時刻 */
	fetchedAt: string;
	/** モックデータかどうか */
	isMock: boolean;
}

export interface MonthlyMetricPoint {
	month: string; // YYYY-MM
	mrr: number;
	activePaidCount: number;
	monthlyRevenue: number;
	churnRate: number;
}

export interface StripeMetricsWithTrend {
	current: StripeMetrics;
	trend: MonthlyMetricPoint[];
}

// ============================================================
// Cache
// ============================================================

let _metricsCache: { data: StripeMetricsWithTrend; fetchedAt: number } | null = null;
const METRICS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ============================================================
// Mock data
// ============================================================

function isMockMode(): boolean {
	return process.env.STRIPE_MOCK === 'true';
}

function generateMockMetrics(): StripeMetricsWithTrend {
	const now = new Date();
	const current: StripeMetrics = {
		mrr: 3500,
		arr: 42000,
		arpu: 583,
		activePaidCount: 6,
		trialToActiveRate: 0.35,
		monthlyChurnRate: 0.05,
		monthlyRevenue: 3500,
		fetchedAt: now.toISOString(),
		isMock: true,
	};

	// 過去 6 か月のダミートレンド
	const trend: MonthlyMetricPoint[] = [];
	for (let i = 5; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const paidCount = Math.max(1, 6 - i);
		trend.push({
			month,
			mrr: paidCount * 500 + Math.round(paidCount * 0.3) * Math.round(5000 / 12),
			activePaidCount: paidCount,
			monthlyRevenue: paidCount * 500,
			churnRate: i > 3 ? 0.1 : 0.05,
		});
	}

	return { current, trend };
}

// ============================================================
// Core calculation logic (pure functions for testability)
// ============================================================

/**
 * テナントのプラン情報から MRR を算出。
 * 月額は額面、年額は /12 で月次換算。
 */
export function calculateMRR(tenants: Tenant[]): number {
	const plans = getPlans();
	let mrr = 0;

	const activeTenants = tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.ACTIVE);

	for (const tenant of activeTenants) {
		if (!tenant.plan) continue;
		const planConfig = plans[tenant.plan as PlanId] as PlanConfig | undefined;
		if (!planConfig) continue;

		if (planConfig.interval === 'month') {
			mrr += planConfig.amount;
		} else if (planConfig.interval === 'year') {
			mrr += Math.round(planConfig.amount / 12);
		}
		// lifetime は MRR 対象外
	}

	return mrr;
}

/**
 * ARPU を算出: MRR / アクティブ有料ユーザー数
 */
export function calculateARPU(mrr: number, activePaidCount: number): number {
	if (activePaidCount === 0) return 0;
	return Math.round(mrr / activePaidCount);
}

/**
 * アクティブ有料サブスク数をカウント
 * (status = active かつプランが設定されている)
 */
export function countActivePaid(tenants: Tenant[]): number {
	return tenants.filter(
		(t) =>
			t.status === SUBSCRIPTION_STATUS.ACTIVE && t.plan != null && t.plan !== LICENSE_PLAN.LIFETIME,
	).length;
}

/**
 * トライアル→有料転換率を算出。
 * 過去 N 日間に trialUsedAt が設定され、かつ status=active & plan!=null のテナントの割合。
 */
export function calculateTrialToActiveRate(tenants: Tenant[], days: number): number {
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	const trialTenants = tenants.filter((t) => t.trialUsedAt && new Date(t.trialUsedAt) >= cutoff);

	if (trialTenants.length === 0) return 0;

	const converted = trialTenants.filter(
		(t) => t.status === SUBSCRIPTION_STATUS.ACTIVE && t.plan != null,
	).length;

	return converted / trialTenants.length;
}

/**
 * 月次解約率を算出。
 * 対象月に terminated になったテナント / 月初時点でアクティブだったテナント。
 */
export function calculateMonthlyChurnRate(tenants: Tenant[], yearMonth: string): number {
	// yearMonth: YYYY-MM
	const [yearStr, monthStr] = yearMonth.split('-');
	const year = Number.parseInt(yearStr ?? '0', 10);
	const month = Number.parseInt(monthStr ?? '0', 10);

	const monthStart = new Date(year, month - 1, 1);
	const monthEnd = new Date(year, month, 0, 23, 59, 59);

	// 月初時点でアクティブだったテナント（月初以前に作成され、月初時点でまだ terminated ではない推定）
	const activeAtStart = tenants.filter(
		(t) =>
			new Date(t.createdAt) < monthStart &&
			(t.status === SUBSCRIPTION_STATUS.ACTIVE ||
				t.status === SUBSCRIPTION_STATUS.GRACE_PERIOD ||
				// terminated だが月内に変わった場合もカウント
				(t.status === SUBSCRIPTION_STATUS.TERMINATED &&
					t.updatedAt &&
					new Date(t.updatedAt) >= monthStart)),
	);

	if (activeAtStart.length === 0) return 0;

	const churned = tenants.filter(
		(t) =>
			t.status === SUBSCRIPTION_STATUS.TERMINATED &&
			t.updatedAt &&
			new Date(t.updatedAt) >= monthStart &&
			new Date(t.updatedAt) <= monthEnd,
	).length;

	return churned / activeAtStart.length;
}

/**
 * 当月の Stripe 売上を取得 (Stripe API 経由)
 */
async function fetchMonthlyRevenueFromStripe(yearMonth: string): Promise<number> {
	if (!isStripeEnabled()) return 0;

	try {
		const stripe = getStripeClient();
		const [yearStr, monthStr] = yearMonth.split('-');
		const year = Number.parseInt(yearStr ?? '0', 10);
		const month = Number.parseInt(monthStr ?? '0', 10);

		const from = new Date(year, month - 1, 1);
		const to = new Date(year, month, 0, 23, 59, 59);

		const invoices = await stripe.invoices.list({
			status: 'paid',
			created: {
				gte: Math.floor(from.getTime() / 1000),
				lte: Math.floor(to.getTime() / 1000),
			},
			limit: 100,
		});

		return invoices.data.reduce((sum, inv) => sum + inv.amount_paid, 0);
	} catch (e) {
		logger.error('[STRIPE-METRICS] Failed to fetch monthly revenue', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return 0;
	}
}

// ============================================================
// Public API
// ============================================================

/**
 * Stripe 収益指標を取得（1 時間キャッシュ）。
 * STRIPE_MOCK=true の場合はダミーデータを返す。
 */
export async function getStripeMetrics(): Promise<StripeMetricsWithTrend> {
	// モックモード
	if (isMockMode()) {
		return generateMockMetrics();
	}

	// キャッシュチェック
	if (_metricsCache && Date.now() - _metricsCache.fetchedAt < METRICS_CACHE_TTL_MS) {
		return _metricsCache.data;
	}

	try {
		const repos = getRepos();
		const tenants = await repos.auth.listAllTenants();

		const now = new Date();
		const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		const activePaidCount = countActivePaid(tenants);
		const mrr = calculateMRR(tenants);
		const arr = mrr * 12;
		const arpu = calculateARPU(mrr, activePaidCount);
		const trialToActiveRate = calculateTrialToActiveRate(tenants, 90);
		const monthlyChurnRate = calculateMonthlyChurnRate(tenants, currentMonth);
		const monthlyRevenue = await fetchMonthlyRevenueFromStripe(currentMonth);

		const current: StripeMetrics = {
			mrr,
			arr,
			arpu,
			activePaidCount,
			trialToActiveRate,
			monthlyChurnRate,
			monthlyRevenue,
			fetchedAt: now.toISOString(),
			isMock: false,
		};

		// 過去 6 か月のトレンド
		const trend: MonthlyMetricPoint[] = [];
		for (let i = 5; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			const churnRate = calculateMonthlyChurnRate(tenants, month);

			// 過去月のスナップショットはDB状態から正確には取れないため、
			// 現在のテナント情報ベースの近似値を使う
			trend.push({
				month,
				mrr: i === 0 ? mrr : mrr, // 過去月は現在値で代替（将来的にはスナップショットDB化）
				activePaidCount: i === 0 ? activePaidCount : activePaidCount,
				monthlyRevenue: i === 0 ? monthlyRevenue : 0,
				churnRate,
			});
		}

		const result: StripeMetricsWithTrend = { current, trend };

		// キャッシュ保存
		_metricsCache = { data: result, fetchedAt: Date.now() };

		return result;
	} catch (e) {
		logger.error('[STRIPE-METRICS] Failed to fetch metrics', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});

		// フォールバック: 空のメトリクス
		return {
			current: {
				mrr: 0,
				arr: 0,
				arpu: 0,
				activePaidCount: 0,
				trialToActiveRate: 0,
				monthlyChurnRate: 0,
				monthlyRevenue: 0,
				fetchedAt: new Date().toISOString(),
				isMock: false,
			},
			trend: [],
		};
	}
}

/** テスト用: キャッシュをクリア */
export function clearMetricsCache(): void {
	_metricsCache = null;
}
