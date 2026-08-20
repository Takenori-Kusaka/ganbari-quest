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
// domain に置くのは、行の型 (`OpsPlanRow`) を描画側と集計側の両方が参照するため。
// **組み立てを呼ぶのは集計側 (ops-service) だけ**で、画面は返ってきた行を描くだけにする
// (画面が自分で単価を掛け直すと、それ自体が 2 つ目の集計になる)。

import { PLAN_MRR_UNIT_YEN } from '$lib/domain/constants/plan-price';
import {
	ALL_SUBSCRIPTION_PLANS,
	type SubscriptionPlan,
} from '$lib/domain/constants/subscription-plan';

/** `/ops` プラン内訳の 1 行。 */
export interface OpsPlanRow {
	plan: SubscriptionPlan;
	tenants: number;
	/** 月次収益への寄与 (買い切りは 0 = 画面では「-」)。 */
	mrr: number;
}

/**
 * プラン集合から内訳の行を作る。
 *
 * 入力が `Record<SubscriptionPlan, number>` なので、プランが増えたときは
 * **呼び出し側の写像がコンパイルエラーになる** (どの集計値を使うかを必ず決めさせる)。
 */
export function buildOpsPlanRows(tenantsByPlan: Record<SubscriptionPlan, number>): OpsPlanRow[] {
	return ALL_SUBSCRIPTION_PLANS.map((plan) => ({
		plan,
		tenants: tenantsByPlan[plan],
		mrr: tenantsByPlan[plan] * PLAN_MRR_UNIT_YEN[plan],
	}));
}

/**
 * 行の MRR 合計。
 *
 * 合計を「行の和」として定義することで、**行に出ているのに合計に入らないプラン**が
 * 存在しえなくなる (#4505 の実害はまさにそれの裏返しで、プレミアムが行にも合計にも無かった)。
 */
export function sumOpsPlanMrr(rows: readonly OpsPlanRow[]): number {
	return rows.reduce((sum, row) => sum + row.mrr, 0);
}
