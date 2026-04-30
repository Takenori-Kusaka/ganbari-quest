// src/lib/server/services/ops-analytics-service.ts
// #822: OPS 分析サービス — LTV / コホート / MRR 内訳
// #1602 (ADR-0023 I13): setup challenges 選択分布を追加
//
// +page.server.ts からビジネスロジックを抽出（アーキテクチャ規約準拠）。

import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { isStripeEnabled } from '$lib/server/stripe/client';

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
			id: number;
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
			id: number;
			nickname: string;
			userPoints: number;
			usagePeriodDays: number;
			message: string;
			consentedAt: string;
		}>;
	};
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export function computeAnalytics(
	tenants: Tenant[],
	now?: Date,
): Omit<
	OpsAnalyticsData,
	'stripeEnabled' | 'fetchedAt' | 'presetDistribution' | 'cancellationReasons' | 'graduation'
> {
	// `presetDistribution` は settings 取得が必要なため computeAnalytics スコープ外。
	// `getAnalyticsData` で別途集計し合成する (#1602)。
	// `cancellationReasons` も同様に repos.cancellationReason 経由で別途集計 (#1596)。
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
		stripeEnabled: false,
		fetchedAt: new Date().toISOString(),
	};
}

/**
 * #1602 / #1742: 全テナントの `questionnaire_challenges` 設定値を取得する。
 *
 * 二段構造 (PR #1696 同パターン):
 *   1. **集計レコード優先** — DynamoDB `PK=CHALLENGE_AGG#<date>` から直近 7 日分を Scan し、
 *      最新の集計を採用する (cron `gq-challenge-aggregator-daily` が 1 日 1 回書込み、TTL 365 日)。
 *      Scan range はテナント数増加時の RCU を抑える観点で 7 日に制限。
 *   2. **ライブ fallback** — 集計が見つからない (cron 未稼働 / 障害 / 7 日以上停止) 場合のみ、
 *      テナントごと settings repo を叩く N+1 で当日値を取得する (#1602 既存ロジック)。
 *
 * 整合性: cron 集計時刻 (03:30 JST) より後にテナントが追加されても、最新集計は遅くとも翌日
 * 反映される (preset 分布画面の更新頻度は週次未満 = 数時間遅延は許容範囲)。
 *
 * Pre-PMF (ADR-0010): 集計レコードが無い (cron 未稼働 / 初回起動) 段階でも N+1 fallback で
 * 必ず動作する。post-PMF / テナント数 1,000+ で N+1 が遅くなる前に cron が走り始めれば自然移行。
 */
async function fetchChallengesPerTenant(tenants: Tenant[]): Promise<string[]> {
	// ─ Step 1: 集計レコード優先取得 (#1742) ─────────────────────────────
	try {
		const { queryLatestChallengeAggregate } = await import('$lib/analytics/providers/dynamo');
		const today = new Date();
		const since = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
		const sinceDate = since.toISOString().slice(0, 10);
		const untilDate = today.toISOString().slice(0, 10);
		const aggregate = await queryLatestChallengeAggregate(sinceDate, untilDate);
		if (aggregate && aggregate.challengesPerTenant.length > 0) {
			logger.debug('[OPS/analytics] Using CHALLENGE_AGG aggregate', {
				context: {
					date: aggregate.date,
					totalTenants: aggregate.totalTenants,
					currentTenantCount: tenants.length,
				},
			});
			return aggregate.challengesPerTenant;
		}
	} catch (e) {
		logger.warn('[OPS/analytics] CHALLENGE_AGG read failed, falling back to live', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
	}

	// ─ Step 2: ライブ集計 fallback (#1602 既存ロジック) ────────────────
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

	return {
		...result,
		presetDistribution,
		cancellationReasons,
		graduation,
		stripeEnabled: isStripeEnabled(),
		fetchedAt: new Date().toISOString(),
	};
}
