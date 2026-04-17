// src/lib/server/services/cohort-analysis-service.ts
// コホート別 LTV / チャーン率推移（リテンションカーブ）サービス (#838)
// 12-事業計画書 §7.3 の LTV 計算式と整合する実測値を算出

import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

// ============================================================
// Types
// ============================================================

/** リテンション計測ポイント（Day N） */
export const RETENTION_DAYS = [1, 7, 14, 30, 60, 90] as const;
export type RetentionDay = (typeof RETENTION_DAYS)[number];

/** 月次コホート */
export interface Cohort {
	/** コホート識別子 (YYYY-MM) */
	month: string;
	/** コホートのテナント数 */
	size: number;
	/** 有料テナント数 */
	paidSize: number;
	/** Day N 別残存率 (0-1) */
	retention: Record<RetentionDay, number | null>;
	/** コホート別累計 LTV (JPY) */
	ltv: number;
	/** サンプル不足かどうか */
	insufficientSample: boolean;
}

export interface CohortAnalysisResult {
	cohorts: Cohort[];
	/** 12-事業計画書 §7.3 の理論値 LTV */
	theoreticalLtv: number;
	/** 全体の ARPU */
	arpu: number;
	/** 全体の月次解約率 */
	monthlyChurnRate: number;
	fetchedAt: string;
}

// ============================================================
// Configuration
// ============================================================

/** 有料コホートのサンプル不足閾値 */
const MIN_PAID_COHORT_SIZE = 10;
/** 無料コホートのサンプル不足閾値 */
const MIN_FREE_COHORT_SIZE = 30;

// ============================================================
// Core Logic
// ============================================================

/**
 * テナントのサインアップ月を YYYY-MM で返す
 */
function getSignupMonth(tenant: Tenant): string {
	return tenant.createdAt.slice(0, 7);
}

/**
 * テナントが「アクティブ」かどうかを判定
 * active の定義: terminated / suspended でない
 */
function isTenantActive(tenant: Tenant): boolean {
	return (
		tenant.status === SUBSCRIPTION_STATUS.ACTIVE ||
		tenant.status === SUBSCRIPTION_STATUS.GRACE_PERIOD
	);
}

/**
 * 指定日からの経過日数を計算
 */
function daysBetween(from: Date, to: Date): number {
	return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Day N 時点での残存率を計算
 * アクティブの定義: その時点で terminated / suspended でないこと
 * (将来的には活動記録ベースに拡張可能)
 */
function calculateRetention(tenants: Tenant[], dayN: RetentionDay, now: Date): number | null {
	if (tenants.length === 0) return null;

	// Day N がまだ到来していないテナントを除外
	const eligibleTenants = tenants.filter((t) => {
		const signup = new Date(t.createdAt);
		return daysBetween(signup, now) >= dayN;
	});

	if (eligibleTenants.length === 0) return null;

	// Day N 時点で active なテナント
	// 簡易実装: 現在 active なテナントは Day N 時点でも active だったとみなす
	// terminated のテナントは updatedAt で判断
	const retainedCount = eligibleTenants.filter((t) => {
		if (isTenantActive(t)) return true;
		// terminated/suspended なテナントは、updatedAt が signup + dayN より後なら
		// Day N 時点ではまだ active だった
		const signup = new Date(t.createdAt);
		const dayNDate = new Date(signup.getTime() + dayN * 24 * 60 * 60 * 1000);
		const statusChanged = new Date(t.updatedAt);
		return statusChanged > dayNDate;
	}).length;

	return retainedCount / eligibleTenants.length;
}

/**
 * コホート別 LTV を計算（実測値）
 * 計算式: コホートの累計支払額 / コホート人数
 *
 * 現在は Stripe から直接コホート別の累計支払額を取得できないため、
 * 有料テナント数 * ARPU * 平均継続月数 で概算する
 */
function calculateCohortLtv(tenants: Tenant[], arpu: number, now: Date): number {
	if (tenants.length === 0) return 0;

	const paidTenants = tenants.filter((t) => t.plan != null);
	if (paidTenants.length === 0) return 0;

	// 各有料テナントの継続月数を計算
	const totalMonths = paidTenants.reduce((sum, t) => {
		const signup = new Date(t.createdAt);
		const months = Math.max(1, Math.ceil(daysBetween(signup, now) / 30));
		return sum + months;
	}, 0);

	const avgMonths = totalMonths / paidTenants.length;
	return Math.round(arpu * avgMonths);
}

/**
 * コホート分析を実行
 */
export async function getCohortAnalysis(monthsBack = 6): Promise<CohortAnalysisResult> {
	const now = new Date();
	const repos = getRepos();

	let tenants: Tenant[];
	try {
		tenants = await repos.auth.listAllTenants();
	} catch (e) {
		logger.error('[cohort-analysis] Failed to list tenants', {
			error: e instanceof Error ? e.message : String(e),
		});
		return emptyResult();
	}

	// テナントをサインアップ月でグルーピング
	const cohortMap = new Map<string, Tenant[]>();
	for (const tenant of tenants) {
		const month = getSignupMonth(tenant);
		const existing = cohortMap.get(month) ?? [];
		existing.push(tenant);
		cohortMap.set(month, existing);
	}

	// 直近 N ヶ月分のコホートを抽出
	const targetMonths: string[] = [];
	for (let i = monthsBack - 1; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		targetMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}

	// 全体メトリクス計算
	const activeTenants = tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.ACTIVE);
	const paidTenants = activeTenants.filter((t) => t.plan != null);

	// ARPU: 月間売上 / 有料ユーザー数 (概算: standard=500, family=780)
	const arpu = paidTenants.length > 0 ? calculateArpu(paidTenants) : 0;

	// 月次解約率
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
	const terminatedThisMonth = tenants.filter((t) => {
		if (t.status !== SUBSCRIPTION_STATUS.TERMINATED) return false;
		const updated = new Date(t.updatedAt);
		return updated >= monthStart;
	}).length;
	const monthlyChurnRate = paidTenants.length > 0 ? terminatedThisMonth / paidTenants.length : 0;

	// 理論値 LTV = ARPU / 月次解約率 (12-事業計画書 §7.3)
	const theoreticalLtv = monthlyChurnRate > 0 ? Math.round(arpu / monthlyChurnRate) : 0;

	// コホート別分析
	const cohorts: Cohort[] = targetMonths.map((month) => {
		const cohortTenants = cohortMap.get(month) ?? [];
		const paidCount = cohortTenants.filter((t) => t.plan != null).length;

		const insufficientSample =
			paidCount > 0
				? paidCount < MIN_PAID_COHORT_SIZE
				: cohortTenants.length < MIN_FREE_COHORT_SIZE;

		const retention: Record<RetentionDay, number | null> = {
			1: null,
			7: null,
			14: null,
			30: null,
			60: null,
			90: null,
		};

		for (const dayN of RETENTION_DAYS) {
			retention[dayN] = calculateRetention(cohortTenants, dayN, now);
		}

		return {
			month,
			size: cohortTenants.length,
			paidSize: paidCount,
			retention,
			ltv: calculateCohortLtv(cohortTenants, arpu, now),
			insufficientSample,
		};
	});

	return {
		cohorts,
		theoreticalLtv,
		arpu,
		monthlyChurnRate,
		fetchedAt: now.toISOString(),
	};
}

/**
 * ARPU を概算する (プラン別単価ベース)
 */
function calculateArpu(paidTenants: Tenant[]): number {
	if (paidTenants.length === 0) return 0;

	// プラン単価 (月額換算)
	const planPrices: Record<string, number> = {
		[LICENSE_PLAN.MONTHLY]: 500,
		[LICENSE_PLAN.YEARLY]: Math.round(5000 / 12), // 417
		[LICENSE_PLAN.FAMILY_MONTHLY]: 780,
		[LICENSE_PLAN.FAMILY_YEARLY]: Math.round(7800 / 12), // 650
		[LICENSE_PLAN.LIFETIME]: 0,
	};

	const totalRevenue = paidTenants.reduce((sum, t) => {
		const price = t.plan ? (planPrices[t.plan] ?? 0) : 0;
		return sum + price;
	}, 0);

	return Math.round(totalRevenue / paidTenants.length);
}

function emptyResult(): CohortAnalysisResult {
	return {
		cohorts: [],
		theoreticalLtv: 0,
		arpu: 0,
		monthlyChurnRate: 0,
		fetchedAt: new Date().toISOString(),
	};
}
