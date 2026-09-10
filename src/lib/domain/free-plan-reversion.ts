// src/lib/domain/free-plan-reversion.ts
// #4585-2: 上限超過リソースの自動アーカイブを起動する条件の SSOT。
//
// 背景: 起動条件は `trialUsed && !isTrialActive` (体験を使ったか) だった。体験を経ずに
// **直接課金した顧客が解約して無料プランに戻っても発火しない** ため、その顧客だけ
// 無料プランの上限が効かないまま有料相当の量を持ち続けていた (#4585 ①)。
// 「売っている制限が解約後に消える」= 有料の根拠が消える class の欠陥である。
//
// 是正: 判定軸を **体験の履歴** から **有料相当 → 無料プランへのプラン遷移** に変える。
// 遷移の起点は 2 つしかない:
//   (a) 体験の終了      … 契約は最初から無い (S1 のまま体験だけが切れる)
//   (b) 契約の終了 (S5) … 解約フロー / 請求パネル / dunning のいずれも
//                         `customer.subscription.deleted` (W5) が終端 S5 を書く
// (b) は **3 経路とも同じ 4 列**に着地するため、経路ごとの分岐を持たない 1 つの述語で足りる
// (契約状態 SSOT: docs/design/billing-redesign/contract-state-matrix.md §4 / §5 W5)。
//
// 発火条件を**広げる**変更なので、広げてはならない状態を明示的に false に落とす:
//   - 実効プランがまだ有料 (体験中 / 支払い猶予 S3) … 上限がまだ効かない段階で消さない
//   - S4 停止 (契約は残り復帰しうる)                 … 支払いが通れば有料に戻る。終端ではない
//   - S1 未課金のまま (体験も契約も一度も無い)        … そもそも失うものが無い

import type { PlanTier } from './constants/plan-tier';
import type { SubscriptionStatus } from './constants/subscription-status';
import { CONTRACT_STATE, resolveContractState } from './contract-state-view';

export interface FreePlanReversionInput {
	/** `resolveFullPlanTier` が返す**実効**プラン (体験中は有料相当になる) */
	planTier: PlanTier;
	/** `families.status` */
	tenantStatus: SubscriptionStatus;
	/** `families.stripe_subscription_id` (解約確定で NULL になる) */
	stripeSubscriptionId?: string | null;
	/** 体験を一度でも開始したか */
	trialUsed: boolean;
	/** 体験期間中か */
	isTrialActive: boolean;
}

/**
 * 「有料相当だったものが無料プランに戻った」= 上限超過分の扱いを確定させる状態か。
 *
 * `true` のときだけ `archiveExcessResources` (fallback) と archive 済みサマリ表示を起動する。
 */
export function hasRevertedToFreePlan(input: FreePlanReversionInput): boolean {
	// 実効プランが有料のあいだは無料プランの上限を適用しない (体験中 / dunning 猶予中)。
	if (input.planTier !== 'free') return false;

	// **契約状態を先に確定させる。** 体験の履歴だけで先に true を返すと、体験 → 課金 →
	// S4 停止 (契約が残る) の顧客で発火する。S4 は invoice.paid (W2) で S2 に戻りうる状態で、
	// 「戻ってくる前提の状態で戻らない処理を先に実行してはならない」
	// (contract-state-matrix.md §契約が残っている間 (S4) は履歴を物理削除しない)。
	const contractState = resolveContractState({
		status: input.tenantStatus,
		stripeSubscriptionId: input.stripeSubscriptionId,
	});

	// (b) 契約の終了 (S5)。解約フロー / 請求パネル / dunning の 3 経路とも同じ終端に着地する。
	if (contractState === CONTRACT_STATE.CANCELLED) return true;

	// (a) 体験の終了。**契約を一度も持っていない (S1) ときだけ**。
	// S4 停止 (契約が残る) / S6 退会 / S2・S3 (実効プランが有料) はここに入らない。
	if (contractState === CONTRACT_STATE.FREE) return input.trialUsed && !input.isTrialActive;

	return false;
}
