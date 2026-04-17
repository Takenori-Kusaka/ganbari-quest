// src/lib/server/services/pricing-trigger-service.ts
// 価格見直しトリガー自動検知サービス (#837)
// docs/design/19-プライシング戦略書.md §8.2 の 5 トリガーを自動判定

import { env } from '$env/dynamic/private';
import { FAMILY_PLANS } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { isStripeEnabled } from '$lib/server/stripe/client';
import { notifyDiscord } from './discord-notify-service';
import { getAWSCostData, getRevenueData } from './ops-service';

// ============================================================
// Types
// ============================================================

export type TriggerId =
	| 'low_conversion'
	| 'high_conversion'
	| 'high_churn'
	| 'high_family_ratio'
	| 'high_aws_cost_ratio';

export interface TriggerResult {
	triggerId: TriggerId;
	fired: boolean;
	value: number;
	threshold: number;
	consecutiveMonths: number;
	requiredMonths: number;
	recommendation: string;
	description: string;
}

export interface PricingTriggerReport {
	month: string;
	evaluatedAt: string;
	triggers: TriggerResult[];
	firedTriggers: TriggerResult[];
	skipped: boolean;
	skipReason?: string;
	paidUserCount: number;
}

export interface MonthlyMetrics {
	month: string; // YYYY-MM
	totalActiveUsers: number;
	paidUsers: number;
	familyPlanUsers: number;
	conversionRate: number; // paidUsers / totalActiveUsers
	churnRate: number; // churned / paidUsers at start of month
	monthlyRevenue: number; // JPY
	awsCost: number; // JPY
}

// ============================================================
// Configuration
// ============================================================

const DEFAULT_MIN_PAID_USERS = 10;

/** USD→JPY の概算換算レート。為替変動時は手動で更新する */
const USD_TO_JPY_RATE = 150;

function getMinPaidUsers(): number {
	const envVal = env.PRICING_TRIGGER_MIN_PAID_USERS;
	if (envVal) {
		const parsed = Number.parseInt(envVal, 10);
		if (!Number.isNaN(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_MIN_PAID_USERS;
}

// ============================================================
// Trigger Definitions (§8.2)
// ============================================================

interface TriggerDefinition {
	triggerId: TriggerId;
	description: string;
	threshold: number;
	requiredMonths: number;
	direction: 'below' | 'above';
	recommendation: string;
	metricExtractor: (m: MonthlyMetrics) => number;
}

const TRIGGER_DEFINITIONS: TriggerDefinition[] = [
	{
		triggerId: 'low_conversion',
		description: '転換率 < 3% が3ヶ月連続',
		threshold: 0.03,
		requiredMonths: 3,
		direction: 'below',
		recommendation: '価格が高すぎる可能性。値下げ or 無料機能拡充を検討',
		metricExtractor: (m) => m.conversionRate,
	},
	{
		triggerId: 'high_conversion',
		description: '転換率 > 10% が3ヶ月連続',
		threshold: 0.1,
		requiredMonths: 3,
		direction: 'above',
		recommendation: '価格が安すぎる可能性。新プラン追加を検討',
		metricExtractor: (m) => m.conversionRate,
	},
	{
		triggerId: 'high_churn',
		description: '解約率 > 10% が2ヶ月連続',
		threshold: 0.1,
		requiredMonths: 2,
		direction: 'above',
		recommendation: '価値が伝わっていない。機能差別化を見直し',
		metricExtractor: (m) => m.churnRate,
	},
	{
		triggerId: 'high_family_ratio',
		description: 'ファミリー比率 > 40%',
		threshold: 0.4,
		requiredMonths: 1,
		direction: 'above',
		recommendation: '需要があるため上位プラン（¥1,200程度）追加を検討',
		metricExtractor: (m) => (m.paidUsers > 0 ? m.familyPlanUsers / m.paidUsers : 0),
	},
	{
		triggerId: 'high_aws_cost_ratio',
		description: 'AWS原価が月間売上の20%超',
		threshold: 0.2,
		requiredMonths: 1,
		direction: 'above',
		recommendation: 'インフラ最適化 or 価格引き上げ',
		metricExtractor: (m) => (m.monthlyRevenue > 0 ? m.awsCost / m.monthlyRevenue : 0),
	},
];

// ============================================================
// Core Logic
// ============================================================

/**
 * 指定月のメトリクスを収集する
 */
export async function collectMonthlyMetrics(year: number, month: number): Promise<MonthlyMetrics> {
	const repos = getRepos();
	const tenants = await repos.auth.listAllTenants();
	const monthStr = `${year}-${String(month).padStart(2, '0')}`;

	const activeTenants = tenants.filter((t) => t.status === SUBSCRIPTION_STATUS.ACTIVE);
	const totalActiveUsers = activeTenants.length;

	// 有料ユーザー = Stripe サブスクリプション保持者（trialUsedAt のみのトライアルユーザーを除外）
	// retention-cleanup-service.ts の deriveLicenseStatus() と同じ判定基準
	const paidUsers = activeTenants.filter((t) => t.stripeSubscriptionId != null).length;
	const familyPlanUsers = activeTenants.filter(
		(t) => t.stripeSubscriptionId != null && t.plan != null && FAMILY_PLANS.includes(t.plan),
	).length;

	const conversionRate = totalActiveUsers > 0 ? paidUsers / totalActiveUsers : 0;

	// 解約率: 当月 terminated になったテナント / 月初の有料ユーザー数
	const monthStart = new Date(year, month - 1, 1);
	const monthEnd = new Date(year, month, 0); // 月末
	const terminatedThisMonth = tenants.filter((t) => {
		if (t.status !== SUBSCRIPTION_STATUS.TERMINATED) return false;
		const updated = new Date(t.updatedAt);
		return updated >= monthStart && updated <= monthEnd;
	}).length;
	const churnRate = paidUsers > 0 ? terminatedThisMonth / paidUsers : 0;

	// 収益
	let monthlyRevenue = 0;
	if (isStripeEnabled()) {
		try {
			const revenueData = await getRevenueData(monthStart, monthEnd);
			monthlyRevenue = revenueData.totalRevenue;
		} catch {
			logger.warn('[pricing-trigger] Failed to fetch revenue data');
		}
	}

	// AWS コスト
	let awsCost = 0;
	try {
		const costData = await getAWSCostData(year, month);
		awsCost = Math.round(costData.total * USD_TO_JPY_RATE);
	} catch {
		logger.warn('[pricing-trigger] Failed to fetch AWS cost data');
	}

	return {
		month: monthStr,
		totalActiveUsers,
		paidUsers,
		familyPlanUsers,
		conversionRate,
		churnRate,
		monthlyRevenue,
		awsCost,
	};
}

/**
 * 単一トリガーの判定
 */
export function evaluateTrigger(
	definition: TriggerDefinition,
	metricsHistory: MonthlyMetrics[],
): TriggerResult {
	// 直近 N ヶ月分のメトリクスで連続判定
	const required = definition.requiredMonths;
	const recentMetrics = metricsHistory.slice(-required);

	let consecutiveMonths = 0;
	for (const m of recentMetrics) {
		const value = definition.metricExtractor(m);
		const breached =
			definition.direction === 'above'
				? value > definition.threshold
				: value < definition.threshold;
		if (breached) {
			consecutiveMonths++;
		} else {
			consecutiveMonths = 0;
		}
	}

	const lastMetric = recentMetrics.at(-1);
	const latestValue = lastMetric ? definition.metricExtractor(lastMetric) : 0;

	return {
		triggerId: definition.triggerId,
		fired: consecutiveMonths >= required,
		value: latestValue,
		threshold: definition.threshold,
		consecutiveMonths,
		requiredMonths: required,
		recommendation: definition.recommendation,
		description: definition.description,
	};
}

/**
 * 全5トリガーの判定を実行
 */
export function evaluateAllTriggers(metricsHistory: MonthlyMetrics[]): TriggerResult[] {
	return TRIGGER_DEFINITIONS.map((def) => evaluateTrigger(def, metricsHistory));
}

/**
 * メインのトリガー検知処理
 * 月次バッチで呼び出される
 */
export async function runPricingTriggerCheck(
	year: number,
	month: number,
): Promise<PricingTriggerReport> {
	const monthStr = `${year}-${String(month).padStart(2, '0')}`;
	const now = new Date().toISOString();

	// 直近メトリクスを収集（最大3ヶ月分）
	const metricsHistory: MonthlyMetrics[] = [];
	for (let i = 2; i >= 0; i--) {
		const targetMonth = month - i;
		let targetYear = year;
		let adjustedMonth = targetMonth;
		if (adjustedMonth <= 0) {
			adjustedMonth += 12;
			targetYear--;
		}
		try {
			const metrics = await collectMonthlyMetrics(targetYear, adjustedMonth);
			metricsHistory.push(metrics);
		} catch (e) {
			logger.warn(
				`[pricing-trigger] Failed to collect metrics for ${targetYear}-${adjustedMonth}`,
				{
					error: e instanceof Error ? e.message : String(e),
				},
			);
		}
	}

	// サンプル不足チェック
	const latestMetrics = metricsHistory[metricsHistory.length - 1];
	const paidUserCount = latestMetrics?.paidUsers ?? 0;
	const minPaidUsers = getMinPaidUsers();

	if (paidUserCount < minPaidUsers) {
		return {
			month: monthStr,
			evaluatedAt: now,
			triggers: [],
			firedTriggers: [],
			skipped: true,
			skipReason: `有料ユーザー数 (${paidUserCount}) が最低閾値 (${minPaidUsers}) 未満のためスキップ`,
			paidUserCount,
		};
	}

	// 全トリガー判定
	const triggers = evaluateAllTriggers(metricsHistory);
	const firedTriggers = triggers.filter((t) => t.fired);

	const report: PricingTriggerReport = {
		month: monthStr,
		evaluatedAt: now,
		triggers,
		firedTriggers,
		skipped: false,
		paidUserCount,
	};

	// 発動トリガーがあれば Discord 通知
	if (firedTriggers.length > 0) {
		await sendPricingTriggerNotification(report);
	}

	return report;
}

// ============================================================
// Discord Notification
// ============================================================

async function sendPricingTriggerNotification(report: PricingTriggerReport): Promise<void> {
	const fields = report.firedTriggers.map((t) => ({
		name: `${t.description}`,
		value: [
			`現在値: ${(t.value * 100).toFixed(1)}%`,
			`閾値: ${(t.threshold * 100).toFixed(1)}%`,
			`連続月数: ${t.consecutiveMonths}/${t.requiredMonths}ヶ月`,
			`推奨: ${t.recommendation}`,
		].join('\n'),
		inline: false,
	}));

	await notifyDiscord('billing', {
		title: `📊 価格見直しトリガー検知 (${report.month})`,
		description: [
			`**${report.firedTriggers.length}件のトリガーが発動しました**`,
			`有料ユーザー数: ${report.paidUserCount}`,
			'',
			'詳細は /ops/business で確認してください。',
			'※ 自動で価格変更は行いません。PO の判断を経由してください。',
		].join('\n'),
		color: 0xff9800, // orange/warning
		fields,
	});
}

/**
 * 現在発動中のトリガー情報を取得（/ops 画面表示用）
 * collectMonthlyMetrics を呼んで最新のメトリクスで判定する
 */
export async function getActiveTriggers(): Promise<PricingTriggerReport> {
	const now = new Date();
	return runPricingTriggerCheck(now.getFullYear(), now.getMonth() + 1);
}

/**
 * テスト・外部から TRIGGER_DEFINITIONS を取得するためのヘルパ
 */
export function getTriggerDefinitions(): readonly TriggerDefinition[] {
	return TRIGGER_DEFINITIONS;
}
