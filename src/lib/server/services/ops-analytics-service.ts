// src/lib/server/services/ops-analytics-service.ts
// #822: OPS 分析サービス — LTV / コホート / MRR 内訳
// #1602 (ADR-0023 I13): setup challenges 選択分布を追加
// #2285 (EPIC #2283): /admin/analytics 撤去に伴い Activation Funnel を ops 側に移動
//
// +page.server.ts からビジネスロジックを抽出（アーキテクチャ規約準拠）。

import { planMrrUnitYen } from '$lib/domain/constants/plan-price';
import { isChurnedContract, SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { shiftMonthKey, utcMonthKey } from '$lib/domain/date-utils';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { isStripeEnabled } from '$lib/server/stripe/client';
import {
	type ActivationFunnelResult,
	getActivationFunnelOnDemand,
} from './analytics-ondemand-service';

// ============================================================
// #1602: Setup challenges preset distribution
// ============================================================

/**
 * #1592 (ADR-0023 I4) で簡素化された setup challenges 3 軸プリセット。
 * Issue #1602 (ADR-0023 I13) では、これら 3 軸の選択分布を ops 分析画面で可視化する。
 *
 * 旧キー (morning / homework / exercise / picky / balanced) も後方互換のため設定値に
 * 残っている可能性があるため、`PRESET_DISTRIBUTION_KEYS` には含めず、`other` バケットに集約する。
 */
export const PRESET_DISTRIBUTION_KEYS = ['homework-daily', 'chores', 'beyond-games'] as const;
export type PresetDistributionKey = (typeof PRESET_DISTRIBUTION_KEYS)[number];

export const PRESET_OTHER_KEY = 'other' as const;
export const PRESET_NONE_KEY = 'none' as const;
export type PresetBucketKey =
	| PresetDistributionKey
	| typeof PRESET_OTHER_KEY
	| typeof PRESET_NONE_KEY;

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

/**
 * #1602: setup challenges プリセット選択分布の 1 行分。
 *
 * - `key` は `PresetBucketKey` で、`homework-daily` / `chores` / `beyond-games` /
 *   `other`（旧キーや未知の値）/ `none`（未回答 = setup スキップ or 未到達）のいずれか。
 * - `count` は同一テナントが複数選択した場合 1 軸ごとに +1 される（重複可）。
 *   `none` のみ「テナント数」と一致する（マルチカウントしない）。
 * - `percentage` は **回答テナント数（none を除く）** に対する割合。
 *   none 行のみ全テナント数に対する割合を持つ（解釈上意味が異なるため）。
 */
export interface PresetDistributionRow {
	key: PresetBucketKey;
	count: number;
	percentage: number;
}

export interface PresetDistribution {
	rows: PresetDistributionRow[];
	/** 回答済みテナント数（challenges を 1 つ以上選択したテナント） */
	answeredTenants: number;
	/** 未回答テナント数（setup 未到達 or skip） */
	unansweredTenants: number;
	/** 全テナント数 */
	totalTenants: number;
}

export interface OpsAnalyticsData {
	monthlyAcquisitions: MonthlyAcquisition[];
	cohorts: CohortRow[];
	ltv: LtvEstimate;
	planBreakdown: PlanBreakdownWithRevenue[];
	/** #1602 (ADR-0023 I13): setup challenges プリセット選択分布 */
	presetDistribution: PresetDistribution;
	/** 解約理由集計 (#1596 / ADR-0023 §3.8 / I3) — 直近 90 日 */
	cancellationReasons: {
		total: number;
		breakdown: Array<{ category: string; count: number; percentage: number }>;
		freeTextSamples: Array<{
			id: string;
			category: string;
			freeText: string;
			createdAt: string;
		}>;
	};
	/** 卒業統計 (#1603 / ADR-0023 §3.8 / §5 I10) — 直近 90 日 */
	graduation: {
		totalGraduations: number;
		consentedCount: number;
		avgUsagePeriodDays: number;
		totalCancellations: number;
		graduationRate: number;
		publicSamples: Array<{
			id: string;
			nickname: string;
			userPoints: number;
			usagePeriodDays: number;
			message: string;
			consentedAt: string;
		}>;
	};
	/** Activation funnel (signup → 初回家庭メンバー登録 → 初回活動完了 → 初回報酬演出) — #2285 (EPIC #2283) */
	activationFunnel: ActivationFunnelResult | null;
	stripeEnabled: boolean;
	fetchedAt: string;
}

// ============================================================
// Helpers (exported for tests)
// ============================================================

/**
 * 月キー (YYYY-MM) を **UTC 基準**で返す (#4015)。
 *
 * 旧実装はローカル TZ getter で、Lambda (UTC) と dev (JST) で結果が分岐していた。
 * ここを JST ではなく UTC に固定するのは、本 module の月キーが `tenant.createdAt`
 * (ISO UTC 文字列) を直接 key 化するためで、cohort-analysis-service が #3449 で
 * 同じ理由から UTC を月境界 SSOT に選んだ決定に揃える (両者の月バケットが食い違うと
 * /ops 上で retention / acquisition が不整合になる)。
 */
export function getMonthKey(date: Date | string): string {
	return utcMonthKey(typeof date === 'string' ? new Date(date) : date);
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export function computeAnalytics(
	tenants: Tenant[],
	now?: Date,
): Omit<
	OpsAnalyticsData,
	| 'stripeEnabled'
	| 'fetchedAt'
	| 'presetDistribution'
	| 'cancellationReasons'
	| 'graduation'
	| 'activationFunnel'
> {
	// `presetDistribution` は settings 取得が必要なため computeAnalytics スコープ外。
	// `getAnalyticsData` で別途集計し合成する (#1602)。
	// `cancellationReasons` も同様に repos.cancellationReason 経由で別途集計 (#1596)。
	const currentDate = now ?? new Date();
	const currentMonth = getMonthKey(currentDate);

	// ── 1. Monthly Acquisitions (過去 12 ヶ月) ──
	const acquisitionMap = new Map<string, MonthlyAcquisition>();
	for (let i = 11; i >= 0; i--) {
		const key = shiftMonthKey(currentMonth, -i);
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
	const cohortMap = new Map<string, { total: number; churned: number }>();
	for (const t of tenants) {
		const key = getMonthKey(t.createdAt);
		if (!cohortMap.has(key)) {
			cohortMap.set(key, { total: 0, churned: 0 });
		}
		const c = cohortMap.get(key);
		if (!c) continue;
		c.total += 1;
		// #3987: 解約判定は isChurnedContract (契約終了 S5 / 退会済 S6) に集約。
		if (isChurnedContract(t)) c.churned += 1;
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

		// #3987: 旧実装は suspended を丸ごと解約扱いし、契約が残り復帰しうる S4 (停止) まで
		// チャーンに混ぜていた。契約終了 (S5) / 退会済 (S6) のみを数える。
		const terminatedCount = c.churned;

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
	const churnedTenants = tenants.filter(isChurnedContract);

	const paidActive = activeTenants.filter((t) => t.plan);

	// MRR: 全プラン対応 (family-monthly / family-yearly 含む)
	let monthlyMrr = 0;
	for (const t of activeTenants) {
		if (t.plan) {
			monthlyMrr += planMrrUnitYen(t.plan);
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
		const mrr = planMrrUnitYen(plan) * count;

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
// #1602: Preset distribution computation (pure function — テスト容易)
// ============================================================

/**
 * 各テナントの `questionnaire_challenges` 設定値（CSV 文字列）の配列から、
 * 3 軸プリセットの選択分布を集計する。
 *
 * 入力例:
 *   ['homework-daily,chores', 'beyond-games', '', 'homework,balanced']
 * 出力 rows:
 *   homework-daily: 1, chores: 1, beyond-games: 1, other: 1（'homework,balanced' = 旧キー）, none: 1
 *
 * - 同一テナントが複数選択 → 各軸 +1（マルチカウント）
 * - 旧キー (#1592 廃止予定) は `other` に集約
 * - 空文字 / undefined は `none`（未回答）にカウント
 * - 集計対象は引数で渡された配列の長さ = totalTenants として扱う
 */
export function computePresetDistribution(
	challengesPerTenant: ReadonlyArray<string | undefined>,
): PresetDistribution {
	const counts: Record<PresetBucketKey, number> = {
		'homework-daily': 0,
		chores: 0,
		'beyond-games': 0,
		[PRESET_OTHER_KEY]: 0,
		[PRESET_NONE_KEY]: 0,
	};
	const knownKeys = new Set<string>(PRESET_DISTRIBUTION_KEYS);
	let answeredTenants = 0;

	for (const raw of challengesPerTenant) {
		const challenges = (raw ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (challenges.length === 0) {
			counts[PRESET_NONE_KEY] += 1;
			continue;
		}
		answeredTenants += 1;
		for (const c of challenges) {
			if (knownKeys.has(c)) {
				counts[c as PresetDistributionKey] += 1;
			} else {
				counts[PRESET_OTHER_KEY] += 1;
			}
		}
	}

	const totalTenants = challengesPerTenant.length;
	const unansweredTenants = totalTenants - answeredTenants;

	const rows: PresetDistributionRow[] = (
		[...PRESET_DISTRIBUTION_KEYS, PRESET_OTHER_KEY, PRESET_NONE_KEY] as readonly PresetBucketKey[]
	).map((key) => {
		const count = counts[key];
		// 'none' の割合は全テナント基準、それ以外は回答テナント基準（ADR-0023 I13）
		const denom = key === PRESET_NONE_KEY ? totalTenants : answeredTenants;
		const percentage = denom > 0 ? Math.round((count / denom) * 1000) / 10 : 0;
		return { key, count, percentage };
	});

	return { rows, answeredTenants, unansweredTenants, totalTenants };
}

// ============================================================
// Public API
// ============================================================

export function emptyPresetDistribution(): PresetDistribution {
	return {
		rows: (
			[...PRESET_DISTRIBUTION_KEYS, PRESET_OTHER_KEY, PRESET_NONE_KEY] as readonly PresetBucketKey[]
		).map((key) => ({ key, count: 0, percentage: 0 })),
		answeredTenants: 0,
		unansweredTenants: 0,
		totalTenants: 0,
	};
}

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
		presetDistribution: emptyPresetDistribution(),
		cancellationReasons: {
			total: 0,
			breakdown: [],
			freeTextSamples: [],
		},
		graduation: {
			totalGraduations: 0,
			consentedCount: 0,
			avgUsagePeriodDays: 0,
			totalCancellations: 0,
			graduationRate: 0,
			publicSamples: [],
		},
		activationFunnel: null,
		stripeEnabled: false,
		fetchedAt: new Date().toISOString(),
	};
}

/**
 * #1602 / #3805: 全テナントの `questionnaire_challenges` 設定値を取得する (on-demand)。
 *
 * #3805 で DynamoDB 事前集計 (旧 CHALLENGE_AGG cron) を撤去し、常設収集なしに settings repo を
 * テナントごと直接読む on-demand 集計へ一本化した。/ops は認証者が必要時に開く前提で、preset
 * 分布画面の描画頻度は稀 (Pre-PMF ~100 テナント) のため N+1 read で十分 (ADR-0010)。
 */
async function fetchChallengesPerTenant(tenants: Tenant[]): Promise<string[]> {
	const repos = getRepos();
	const challengesPerTenant: string[] = [];
	for (const t of tenants) {
		try {
			const value = await repos.settings.getSetting('questionnaire_challenges', t.tenantId);
			challengesPerTenant.push(value ?? '');
		} catch (e) {
			logger.warn('[OPS/analytics] Failed to read questionnaire_challenges', {
				context: { tenantId: t.tenantId, error: e instanceof Error ? e.message : String(e) },
			});
			challengesPerTenant.push('');
		}
	}
	return challengesPerTenant;
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
	const challengesPerTenant = await fetchChallengesPerTenant(tenants);
	const presetDistribution = computePresetDistribution(challengesPerTenant);

	// #1596: 解約理由集計（直近 90 日）+ 自由記述サンプル（最新 20 件）
	let cancellationReasons: OpsAnalyticsData['cancellationReasons'] = {
		total: 0,
		breakdown: [],
		freeTextSamples: [],
	};
	try {
		const [aggregation, samples] = await Promise.all([
			repos.cancellationReason.aggregateRecent(90),
			repos.cancellationReason.searchFreeText('', 20),
		]);
		cancellationReasons = {
			total: aggregation.total,
			breakdown: aggregation.breakdown.map((b) => ({
				category: b.category,
				count: b.count,
				percentage: b.percentage,
			})),
			freeTextSamples: samples
				.filter((s) => s.freeText)
				.map((s) => ({
					id: s.id,
					category: s.category,
					freeText: s.freeText ?? '',
					createdAt: s.createdAt,
				})),
		};
	} catch (e) {
		logger.warn('[OPS/analytics] Failed to load cancellation reasons', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
	}

	// #1603: 卒業統計（直近 90 日）— graduation-service.getGraduationStats と同じロジックを
	// 直接呼ばずに repos から組み立てる（循環 import 回避）
	let graduation: OpsAnalyticsData['graduation'] = {
		totalGraduations: 0,
		consentedCount: 0,
		avgUsagePeriodDays: 0,
		totalCancellations: cancellationReasons.total,
		graduationRate: 0,
		publicSamples: [],
	};
	try {
		const stats = await repos.graduationConsent.aggregateRecent(90);
		const totalCancellations = cancellationReasons.total;
		const graduationRate =
			totalCancellations > 0
				? Math.round((stats.totalGraduations / totalCancellations) * 1000) / 1000
				: 0;
		graduation = {
			totalGraduations: stats.totalGraduations,
			consentedCount: stats.consentedCount,
			avgUsagePeriodDays: stats.avgUsagePeriodDays,
			totalCancellations,
			graduationRate,
			publicSamples: stats.publicSamples,
		};
	} catch (e) {
		logger.warn('[OPS/analytics] Failed to load graduation stats', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
	}

	// #2285 (EPIC #2283): Activation Funnel を ops 側に移動。
	// #3805: DynamoDB event 集計から DSQL main data 由来の on-demand 集計へ載せ替え。
	// funnelPeriod = '30d' 固定 (ops 専用、period switch UI なし、Pre-PMF コスト最小化)。
	let activationFunnel: ActivationFunnelResult | null = null;
	try {
		activationFunnel = await getActivationFunnelOnDemand('30d');
	} catch (e) {
		logger.warn('[OPS/analytics] Failed to load activation funnel', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
	}

	return {
		...result,
		presetDistribution,
		cancellationReasons,
		graduation,
		activationFunnel,
		stripeEnabled: isStripeEnabled(),
		fetchedAt: new Date().toISOString(),
	};
}
