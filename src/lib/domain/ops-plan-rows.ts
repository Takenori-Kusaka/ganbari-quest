// src/lib/domain/ops-plan-rows.ts (#4505)
//
// `/ops` の「プラン別内訳」の **行の作り方** を 1 箇所に置く。
//
// # なぜ必要か
//
// 旧実装は集計 (ops-service) と描画 (ops/+page.svelte) の双方がプランを手で並べていた。
// プレミアム (family-monthly / family-yearly) を追加したとき描画側だけ追従漏れし、
// **プレミアム契約のテナントがどの行にも現れず、合計 MRR からも欠落**した (#4505 実測)。
// 経営数値なので、欠落しても画面は正常に見えるのが最悪の性質。
//
// 行をプラン集合 (`ALL_SUBSCRIPTION_PLANS`) から組み立てれば、プランが増えたときに
// 画面から漏れることが構造的に起きない。単価は `PLAN_MRR_UNIT_YEN` (SSOT) を引く。
//
// domain に置くのは、描画 (client) と集計 (server) の両方が同じ関数を読むため
// (`$lib/server/*` を client から import することはできない)。

import { PLAN_MRR_UNIT_YEN } from './constants/plan-price';
import { ALL_SUBSCRIPTION_PLANS, type SubscriptionPlan } from './constants/subscription-plan';

/** `/ops` プラン内訳の 1 行。 */
export interface OpsPlanRow {
	plan: SubscriptionPlan;
	tenants: number;
	/** 月次収益への寄与 (買い切りは 0 = 画面では「-」)。 */
	mrr: number;
}

/** 行の組み立てに必要な集計値 (ops-service の `planBreakdown` と同型)。 */
export interface OpsPlanCounts {
	monthly: number;
	yearly: number;
	familyMonthly: number;
	familyYearly: number;
	lifetime: number;
}

/**
 * プラン集合から内訳の行を作る。
 *
 * `counts` は `Record<SubscriptionPlan, number>` に写してから引くため、プランが増えたときは
 * **この写像がコンパイルエラーになる** (どの集計値を使うかを必ず決めさせる)。
 */
export function buildOpsPlanRows(counts: OpsPlanCounts): OpsPlanRow[] {
	const byPlan: Record<SubscriptionPlan, number> = {
		monthly: counts.monthly,
		yearly: counts.yearly,
		'family-monthly': counts.familyMonthly,
		'family-yearly': counts.familyYearly,
		lifetime: counts.lifetime,
	};
	return ALL_SUBSCRIPTION_PLANS.map((plan) => ({
		plan,
		tenants: byPlan[plan],
		mrr: byPlan[plan] * PLAN_MRR_UNIT_YEN[plan],
	}));
}
