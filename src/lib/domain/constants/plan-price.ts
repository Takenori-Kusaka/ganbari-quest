// src/lib/domain/constants/plan-price.ts
// プラン単価 (円) の値 SSOT (#4533)。
//
// 背景:
//   単価は長らく「MRR 集計 (ops-analytics-service / cohort-analysis-service / ops-service)」
//   「Stripe 実請求額 (stripe/config.ts の amount)」「表示文字列 (terms.ts PRICE_TERMS /
//   labels.ts / plan-features.ts)」の 3 系統に複製されていた。値上げ・プラン改定のときに
//   片方だけ直すと /ops の経営数値 (MRR / ARPU / LTV) が静かにずれ、しかも画面に警告は出ない。
//   本ファイルを値の唯一の定義とし、集計・課金・表示の全経路がここから引く。
//
// 置き場所の判断:
//   labels.ts / terms.ts は domain 層であり `$lib/server/**` を import できない。
//   一方 MRR 集計と Stripe 設定は server 専用 module。したがって値を domain leaf に降ろし、
//   server 側がここから import する (履歴保持日数を同じ理由で降ろした #4477 と同型)。
//
// 関連: ADR-0013 (表示は実装の事実を SSOT とする) / ADR-0045 (terms.ts atom / labels.ts compound)
//       ADR-0061 (fitness function) / #4477 constants/plan-retention.ts

import { SUBSCRIPTION_PLAN, type SubscriptionPlan } from './subscription-plan';

/**
 * プラン別の**請求額** (円、課金 interval あたり)。
 *
 * - monthly / family-monthly … 1 か月あたりの請求額
 * - yearly / family-yearly … 1 年あたりの請求額 (#2719 で新規購入は停止済。historical record)
 * - lifetime … 買い切り。月次の経常収益を生まないため MRR 換算は 0
 *
 * **この 5 つの数値がプロダクト全体の SSOT**。集計側にも表示側にも数値を複製しないこと。
 * Stripe に登録されている実 Price と同額でなければならない (`stripe/config.ts` が本定数を引く)。
 * ただし実際の請求は Stripe の Price ID が行うため、**本定数と Stripe 実 Price の一致を検証する機構は無い**
 * (料金改定時は Stripe 側の Price 作成と本定数の更新を必ず同じ作業で行う)。
 *
 * **本定数は「現行の定価」であり、過去に請求された額の記録ではない** (#4533)。
 * 料金改定を行うと、旧価格で契約した既存テナントの MRR も新価格で再計算される
 * (`stripe-metrics-service` の historical yearly 換算を含む)。過去契約者を旧価格で
 * 評価し続ける必要が出た時点で、本定数に有効期間付きの価格履歴を持たせること。
 * 現時点では料金改定が一度も発生しておらず、定価 = 全契約者の請求額であるため単一値で足りる。
 */
export const PLAN_PRICE_YEN: Record<SubscriptionPlan, number> = {
	[SUBSCRIPTION_PLAN.MONTHLY]: 500,
	[SUBSCRIPTION_PLAN.YEARLY]: 5000,
	[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]: 780,
	[SUBSCRIPTION_PLAN.FAMILY_YEARLY]: 7800,
	[SUBSCRIPTION_PLAN.LIFETIME]: 0,
};

/** プラン別の課金周期あたり月数 (MRR 換算の除数)。lifetime は経常収益ではないため対象外。 */
const PLAN_BILLING_MONTHS: Record<SubscriptionPlan, number | null> = {
	[SUBSCRIPTION_PLAN.MONTHLY]: 1,
	[SUBSCRIPTION_PLAN.YEARLY]: 12,
	[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]: 1,
	[SUBSCRIPTION_PLAN.FAMILY_YEARLY]: 12,
	[SUBSCRIPTION_PLAN.LIFETIME]: null,
};

/**
 * プラン別の **MRR 単価** (月次換算、円)。`PLAN_PRICE_YEN` からの導出値。
 *
 * 年額は 12 で割って四捨五入する (5000 → 417 / 7800 → 650)。lifetime は 0。
 * /ops の MRR・プラン内訳・ARPU・LTV は全てここを引き、独自の換算式を持たない。
 */
export const PLAN_MRR_UNIT_YEN: Record<SubscriptionPlan, number> = Object.fromEntries(
	Object.entries(PLAN_PRICE_YEN).map(([plan, price]) => {
		const months = PLAN_BILLING_MONTHS[plan as SubscriptionPlan];
		return [plan, months === null ? 0 : Math.round(price / months)];
	}),
) as Record<SubscriptionPlan, number>;

/**
 * 月次の経常収益を生むプランか (#4505)。
 *
 * 買い切り (lifetime) は MRR に寄与しないため false。**「単価が 0 円」と「経常収益の対象外」は
 * 別の意味**であり、画面はこれを区別して描く必要がある (契約 0 件の月額プランは ¥0、
 * 買い切りは「-」)。判定を課金周期表から導いておかないと、表示側が `mrr > 0` のような
 * 代用条件を書き、契約 0 件の月額プランまで「-」になる。
 */
export function isRecurringPlan(plan: SubscriptionPlan): boolean {
	return PLAN_BILLING_MONTHS[plan] !== null;
}

/**
 * 任意の plan 値 (DB 由来の文字列 / null) から MRR 単価を引く。
 *
 * 集計側は `tenant.plan` を `string | null` で扱うため、未知の値・未設定を 0 に落とす
 * 「引き方」も SSOT 側に置く (各 service が独自に `?? 0` を書くと、単価表を差し替えたときに
 * fallback の扱いが分岐する)。
 */
export function planMrrUnitYen(plan: string | null | undefined): number {
	if (!plan) return 0;
	return PLAN_MRR_UNIT_YEN[plan as SubscriptionPlan] ?? 0;
}

/**
 * 金額を表示用の円文字列にする (`500` → `¥500` / `5000` → `¥5,000`)。
 *
 * 3 桁区切りは表示側 (LP / 料金カード / /ops) の既存表記に合わせる。ロケール依存の
 * `toLocaleString()` は使わない (Lambda(UTC/POSIX) と dev(ja-JP) で区切りが分岐しうるため)。
 */
export function formatYen(amount: number): string {
	return `¥${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
