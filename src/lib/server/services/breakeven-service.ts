// src/lib/server/services/breakeven-service.ts
// 損益分岐点分析サービス (#836)
//
// 19-プライシング戦略書.md §6 の損益分岐点分析に準拠。
// Stripe 売上 + AWS Cost Explorer データを統合して事業採算性を算出。

import { logger } from '$lib/server/logger';
import { type AWSCostData, getAWSCostData } from '$lib/server/services/ops-service';
import { getStripeMetrics, type StripeMetrics } from '$lib/server/services/stripe-metrics-service';

// ============================================================
// Types
// ============================================================

/** 規模帯の定義 (19-プライシング戦略書 §6.3) */
export interface ScaleTier {
	id: string;
	label: string;
	minUsers: number;
	maxUsers: number | null;
	monthlyRevenueEstimate: number;
}

export interface BreakevenData {
	/** 今月の収益 (JPY) */
	monthlyRevenue: number;
	/** 今月の AWS 原価 (JPY) */
	awsCostJpy: number;
	/** AWS 原価 (USD) */
	awsCostUsd: number;
	/** Stripe 手数料 (JPY, 売上 x 3.6%) */
	stripeFee: number;
	/** 固定費合計 (JPY) */
	fixedCosts: number;
	/** 固定費明細 */
	fixedCostBreakdown: { label: string; amount: number }[];
	/** 損益分岐点ユーザー数 */
	breakevenUsers: number;
	/** 現在の有料ユーザー数 */
	currentPaidUsers: number;
	/** 進捗率 (0-1, 1以上は黒字) */
	progressRate: number;
	/** 月間利益 (JPY) */
	monthlyProfit: number;
	/** 現在の規模帯 */
	currentScaleTier: ScaleTier;
	/** 全規模帯 */
	scaleTiers: ScaleTier[];
	/** Stripe 指標 */
	metrics: StripeMetrics;
	/** AWS コストデータ */
	awsCosts: AWSCostData;
	/** モックデータかどうか */
	isMock: boolean;
	/** 取得時刻 */
	fetchedAt: string;
}

// ============================================================
// Constants
// ============================================================

/** USD → JPY 概算レート */
const USD_TO_JPY = 150;

/** Stripe 手数料率 (日本: 3.6%) */
const STRIPE_FEE_RATE = 0.036;

/** 月額単価 (JPY) — 19-プライシング戦略書 §6.2 */
const MONTHLY_PRICE = 500;

/** Stripe 手数料率を差し引いた手取り率 */
const NET_RATE = 1 - STRIPE_FEE_RATE; // 0.964

/** 規模帯定義 (19-プライシング戦略書 §6.3) */
export const SCALE_TIERS: ScaleTier[] = [
	{
		id: 'minimum',
		label: '最小',
		minUsers: 0,
		maxUsers: 2,
		monthlyRevenueEstimate: 1000,
	},
	{
		id: 'small',
		label: '小規模',
		minUsers: 3,
		maxUsers: 10,
		monthlyRevenueEstimate: 5000,
	},
	{
		id: 'medium',
		label: '中規模',
		minUsers: 11,
		maxUsers: 50,
		monthlyRevenueEstimate: 25000,
	},
	{
		id: 'target',
		label: '目標',
		minUsers: 51,
		maxUsers: null,
		monthlyRevenueEstimate: 50000,
	},
];

// ============================================================
// Pure calculation functions (for testability)
// ============================================================

/**
 * 固定費を算出。
 * ドメイン費: ¥117/月 (env で上書き可)
 * バーチャルオフィス: env から取得 (デフォルト 0)
 */
export function calculateFixedCosts(): {
	total: number;
	breakdown: { label: string; amount: number }[];
} {
	const domainCost = Number.parseInt(process.env.OPS_DOMAIN_COST_JPY ?? '117', 10);
	const virtualOfficeCost = Number.parseInt(process.env.OPS_VIRTUAL_OFFICE_COST_JPY ?? '0', 10);

	const breakdown: { label: string; amount: number }[] = [];

	if (domainCost > 0) {
		breakdown.push({ label: 'ドメイン費', amount: domainCost });
	}
	if (virtualOfficeCost > 0) {
		breakdown.push({ label: 'バーチャルオフィス', amount: virtualOfficeCost });
	}

	return {
		total: breakdown.reduce((sum, item) => sum + item.amount, 0),
		breakdown,
	};
}

/**
 * 損益分岐点ユーザー数を算出。
 * BEP = 固定費合計 / (月額単価 × 手取り率)
 */
export function calculateBreakevenUsers(totalFixedCosts: number, awsCostJpy: number): number {
	const totalCosts = totalFixedCosts + awsCostJpy;
	const netPerUser = MONTHLY_PRICE * NET_RATE;
	if (netPerUser <= 0) return 0;
	return Math.ceil(totalCosts / netPerUser);
}

/**
 * Stripe 手数料を算出: 売上 × 3.6%
 */
export function calculateStripeFee(revenue: number): number {
	return Math.round(revenue * STRIPE_FEE_RATE);
}

/**
 * 月間利益を算出: 売上 - AWS原価 - Stripe手数料 - 固定費
 */
export function calculateMonthlyProfit(
	revenue: number,
	awsCostJpy: number,
	stripeFee: number,
	fixedCosts: number,
): number {
	return revenue - awsCostJpy - stripeFee - fixedCosts;
}

/**
 * 進捗率を算出: 有料ユーザー数 / 損益分岐点ユーザー数
 */
export function calculateProgressRate(currentPaidUsers: number, breakevenUsers: number): number {
	if (breakevenUsers <= 0) return currentPaidUsers > 0 ? 1 : 0;
	return currentPaidUsers / breakevenUsers;
}

/**
 * 現在の規模帯を判定
 */
export function getCurrentScaleTier(paidUsers: number): ScaleTier {
	for (let i = SCALE_TIERS.length - 1; i >= 0; i--) {
		const tier = SCALE_TIERS[i];
		if (tier && paidUsers >= tier.minUsers) {
			return tier;
		}
	}
	return SCALE_TIERS[0] as ScaleTier;
}

// ============================================================
// Mock data
// ============================================================

function isMockMode(): boolean {
	return process.env.STRIPE_MOCK === 'true';
}

function generateMockBreakevenData(): BreakevenData {
	const now = new Date();
	const fixedCostResult = calculateFixedCosts();

	const mockMetrics: StripeMetrics = {
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

	const mockAwsCosts: AWSCostData = {
		month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
		services: [
			{ service: 'AWS Lambda', amount: 0.5, unit: 'USD' },
			{ service: 'Amazon DynamoDB', amount: 2.8, unit: 'USD' },
			{ service: 'Amazon S3', amount: 0.15, unit: 'USD' },
		],
		total: 3.45,
		fetchedAt: now.toISOString(),
	};

	const awsCostJpy = Math.round(mockAwsCosts.total * USD_TO_JPY);
	const stripeFee = calculateStripeFee(mockMetrics.monthlyRevenue);
	const breakevenUsers = calculateBreakevenUsers(fixedCostResult.total, awsCostJpy);
	const progressRate = calculateProgressRate(mockMetrics.activePaidCount, breakevenUsers);
	const monthlyProfit = calculateMonthlyProfit(
		mockMetrics.monthlyRevenue,
		awsCostJpy,
		stripeFee,
		fixedCostResult.total,
	);

	return {
		monthlyRevenue: mockMetrics.monthlyRevenue,
		awsCostJpy,
		awsCostUsd: mockAwsCosts.total,
		stripeFee,
		fixedCosts: fixedCostResult.total,
		fixedCostBreakdown: fixedCostResult.breakdown,
		breakevenUsers,
		currentPaidUsers: mockMetrics.activePaidCount,
		progressRate,
		monthlyProfit,
		currentScaleTier: getCurrentScaleTier(mockMetrics.activePaidCount),
		scaleTiers: SCALE_TIERS,
		metrics: mockMetrics,
		awsCosts: mockAwsCosts,
		isMock: true,
		fetchedAt: now.toISOString(),
	};
}

// ============================================================
// Public API
// ============================================================

/**
 * 損益分岐点データを取得。
 * Stripe 指標 + AWS Cost Explorer を統合。
 */
export async function getBreakevenData(): Promise<BreakevenData> {
	if (isMockMode()) {
		return generateMockBreakevenData();
	}

	try {
		const now = new Date();
		const year = now.getFullYear();
		const month = now.getMonth() + 1;

		// 並列取得: Stripe 指標 + AWS 原価 (既存データソースを再利用)
		const [metricsResult, awsCosts] = await Promise.all([
			getStripeMetrics(),
			getAWSCostData(year, month),
		]);

		const metrics = metricsResult.current;
		const awsCostJpy = Math.round(awsCosts.total * USD_TO_JPY);
		const fixedCostResult = calculateFixedCosts();
		const stripeFee = calculateStripeFee(metrics.monthlyRevenue);
		const breakevenUsers = calculateBreakevenUsers(fixedCostResult.total, awsCostJpy);
		const progressRate = calculateProgressRate(metrics.activePaidCount, breakevenUsers);
		const monthlyProfit = calculateMonthlyProfit(
			metrics.monthlyRevenue,
			awsCostJpy,
			stripeFee,
			fixedCostResult.total,
		);

		return {
			monthlyRevenue: metrics.monthlyRevenue,
			awsCostJpy,
			awsCostUsd: awsCosts.total,
			stripeFee,
			fixedCosts: fixedCostResult.total,
			fixedCostBreakdown: fixedCostResult.breakdown,
			breakevenUsers,
			currentPaidUsers: metrics.activePaidCount,
			progressRate,
			monthlyProfit,
			currentScaleTier: getCurrentScaleTier(metrics.activePaidCount),
			scaleTiers: SCALE_TIERS,
			metrics,
			awsCosts,
			isMock: false,
			fetchedAt: now.toISOString(),
		};
	} catch (e) {
		logger.error('[BREAKEVEN] Failed to fetch breakeven data', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		// フォールバック: モックデータ (エラー時でもUIは表示可能に)
		return generateMockBreakevenData();
	}
}
