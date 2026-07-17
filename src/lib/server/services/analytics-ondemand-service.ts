// src/lib/server/services/analytics-ondemand-service.ts
// EPIC #3424 / #3805: on-demand marketing 分析サービス (DSQL main data 由来)。
//
// 背景 (#3805): 従来 analytics は DynamoDB に activation event を continuous 収集し、日次 cron で
// 集計、常設 /ops dashboard が参照していた。PO 方針で「必要時のみ分析、常設収集 / dashboard は
// Pre-PMF で過剰」と整理され、DSQL 移管に合わせて **on-demand 化** する。marketing 分析の能力は
// 維持しつつ always-on collection を撤去し、DynamoDB analytics 依存を完全撤去する。
//
// 本サービスは read-only:
//   - activation funnel (signup → 初回子供登録 → 初回活動 → 7 日継続) を families / children /
//     activity_logs から on-demand 集計する (repos.activationFunnel、単一集約 SQL、ADR-0065)。
//   - cancellation 30d/90d は cancellation_reasons テーブルから on-demand 集計する
//     (getCancellationReasonAggregation を再利用、既に DSQL main data 由来)。
//
// 常設 cron / collection は持たない。認証済 ops が必要時に呼ぶ。on-demand ゆえ常時コスト 0。
//
// #3805 設計判断: 旧 step ④ (first_reward_seen) は純 UI view event でデータ痕跡がなく DSQL から
// 導出不能のため drop し、engagement 本質である「7 日 retention」を ④ に据える (PO 方針整合)。

import { getRepos } from '$lib/server/db/factory';
import type { CancellationReasonAggregation } from '$lib/server/db/interfaces/cancellation-reason-repo.interface';
import { getCancellationReasonAggregation } from './cancellation-service';

// ── Activation Funnel ─────────────────────────────────────────

/** activation funnel 集計期間。 */
export type ActivationFunnelPeriod = '7d' | '30d';

/** funnel 単段の結果 (ops 表示互換 shape)。 */
export interface ActivationFunnelStep {
	/** Step ID (1-4): signup / first_child / first_activity / retained_7d */
	step: number;
	/** 内部 event 名 (ラベル辞書のキー兼用)。 */
	eventName: string;
	/** 当該段に到達した家庭 (tenant) のユニーク件数。 */
	count: number;
	/** 前段からの遷移率 (0-1)。Step 1 は常に 1。 */
	conversionFromPrev: number;
}

export interface ActivationFunnelResult {
	period: ActivationFunnelPeriod;
	/** funnel 順 (1 → 4) の段配列。 */
	steps: ActivationFunnelStep[];
	/** 走査したコホート日数 (period 相当)。 */
	scannedDates: number;
	fetchedAt: string;
}

/** retention 判定窓 (日)。signup から本日数以内の活動を「継続」とみなす。 */
const RETENTION_WINDOW_DAYS = 7;

/**
 * funnel 各段の内部 event 名 (ops ラベル辞書 activationFunnelStepLabels のキーと一致させる)。
 * ④ は #3805 で first_reward_seen (drop) から retained_7d へ置換。
 */
const FUNNEL_STEP_EVENT_NAMES = [
	'activation_signup_completed',
	'activation_first_child_added',
	'activation_first_activity_completed',
	'activation_retained_7d',
] as const;

/** 今 (UTC) から daysAgo 日前の ISO8601 文字列を返す。 */
function isoDaysAgo(daysAgo: number): string {
	return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * activation funnel を on-demand 集計する (#3805 AC2)。
 *
 * signup 起点コホート (families.created_at >= since) を横断し、単一集約 SQL で 4 段
 * (signup / 初回子供登録 / 初回活動 / 7 日継続) の家庭ユニーク件数を導出する。
 * DynamoDB event stream 不要、常設収集なし、実行時のみ DSQL DPU を消費する。
 */
export async function getActivationFunnelOnDemand(
	period: ActivationFunnelPeriod = '30d',
): Promise<ActivationFunnelResult> {
	const days = period === '7d' ? 7 : 30;
	const sinceIso = isoDaysAgo(days);
	const repos = getRepos();
	const counts = await repos.activationFunnel.getActivationFunnelCounts(
		sinceIso,
		RETENTION_WINDOW_DAYS,
	);

	const ordered = [
		counts.signupCount,
		counts.firstChildCount,
		counts.firstActivityCount,
		counts.retained7dCount,
	];

	const steps: ActivationFunnelStep[] = FUNNEL_STEP_EVENT_NAMES.map((eventName, idx) => {
		const count = ordered[idx] ?? 0;
		const prev = idx === 0 ? count : (ordered[idx - 1] ?? 0);
		const conversionFromPrev = idx === 0 ? 1 : prev > 0 ? count / prev : 0;
		return { step: idx + 1, eventName, count, conversionFromPrev };
	});

	return {
		period,
		steps,
		scannedDates: days,
		fetchedAt: new Date().toISOString(),
	};
}

// ── Cancellation reasons ──────────────────────────────────────

/** 解約理由集計期間。 */
export type CancellationReasonPeriod = '30d' | '90d';

export interface CancellationReasonResult {
	period: CancellationReasonPeriod;
	total: number;
	breakdown: CancellationReasonAggregation[];
	fetchedAt: string;
}

/**
 * 解約理由分布を on-demand 集計する (#3805 AC2)。
 *
 * cancellation_reasons テーブル (DSQL main data) を直接集計する。DynamoDB 事前集計
 * スナップショット (旧 ANALYTICS_AGG) は撤去済で、常設収集なしに必要時算出する。
 */
export async function getCancellationReasonsOnDemand(
	period: CancellationReasonPeriod = '90d',
): Promise<CancellationReasonResult> {
	const days = period === '30d' ? 30 : 90;
	const { total, breakdown } = await getCancellationReasonAggregation(days);
	return {
		period,
		total,
		breakdown,
		fetchedAt: new Date().toISOString(),
	};
}
