// tests/unit/domain/free-plan-reversion.test.ts
// #4585-2: 上限超過リソースの自動アーカイブ起動条件 (`hasRevertedToFreePlan`) の回帰。
//
// 本 test の主眼は 2 つ:
//   1. **体験を経ずに直接課金 → 解約**した顧客で発火すること (#4585 ①。旧条件
//      `trialUsed && !isTrialActive` では永久に false だった)
//   2. 発火条件を広げたことで、**広げてはならない状態で発火しない**こと
//      (体験中 / 支払い猶予 / 停止 / 未課金)。顧客の記録が消える経路なので、
//      「発火する」条件と同じ強さで「発火しない」条件を固定する
//
// 契約状態の呼称は docs/design/billing-redesign/contract-state-matrix.md §4 (S1〜S6) に揃える。

import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import {
	type FreePlanReversionInput,
	hasRevertedToFreePlan,
} from '$lib/domain/free-plan-reversion';
import { TERMINAL_CONTRACT_STATE } from '$lib/server/services/stripe-service';

/** 体験を一度も使っていない顧客 (直接課金した顧客はここに属する) */
const NEVER_TRIALED = { trialUsed: false, isTrialActive: false } as const;

/**
 * S5 契約終了。**3 経路 (解約フロー / 請求パネル / dunning) の終端はすべてここ**で、
 * `customer.subscription.deleted` (W5) が `TERMINAL_CONTRACT_STATE` を書く。
 * 期待値をベタ書きせず実物を読むことで、書き手が変わればこの test が落ちる。
 */
const S5_CONTRACT_ENDED = {
	tenantStatus: TERMINAL_CONTRACT_STATE.status,
	stripeSubscriptionId: TERMINAL_CONTRACT_STATE.stripeSubscriptionId,
} as const;

describe('hasRevertedToFreePlan (#4585-2 自動アーカイブの起動条件)', () => {
	describe('発火する', () => {
		it('体験を使わず直接課金した顧客が解約して無料プランに戻ったとき (#4585 ①)', () => {
			// 旧条件 `trialUsed && !isTrialActive` は trialUsed=false のため false のままで、
			// この顧客だけ無料プランの上限が一切効かなかった。
			expect(
				hasRevertedToFreePlan({
					planTier: 'free',
					...S5_CONTRACT_ENDED,
					...NEVER_TRIALED,
				}),
			).toBe(true);
		});

		it('3 経路 (解約フロー / 請求パネル / dunning) が同じ条件で発火する', () => {
			// 3 経路は入口が違うだけで、契約の終端は同じ 4 列 (S5) に着地する。
			// 経路名で分岐する実装を作ると「経路ごとに残るものが変わる」ため、
			// 同一入力に対する結果が 1 つであることを固定する。
			const routes = ['解約フロー', '請求パネル', 'dunning'] as const;
			const results = routes.map((route) => ({
				route,
				fired: hasRevertedToFreePlan({
					planTier: 'free',
					...S5_CONTRACT_ENDED,
					...NEVER_TRIALED,
				}),
			}));
			expect(results).toEqual(routes.map((route) => ({ route, fired: true })));
		});

		it('体験終了で無料プランに戻ったとき (従来経路。契約は最初から無い)', () => {
			expect(
				hasRevertedToFreePlan({
					planTier: 'free',
					tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
					stripeSubscriptionId: null,
					trialUsed: true,
					isTrialActive: false,
				}),
			).toBe(true);
		});

		it('体験も契約も経た顧客が解約したとき', () => {
			expect(
				hasRevertedToFreePlan({
					planTier: 'free',
					...S5_CONTRACT_ENDED,
					trialUsed: true,
					isTrialActive: false,
				}),
			).toBe(true);
		});
	});

	describe('発火しない (顧客の記録が消える経路を広げすぎない)', () => {
		const cases: { name: string; input: FreePlanReversionInput }[] = [
			{
				name: 'S1 未課金のまま (体験も契約も一度も無い)',
				input: {
					planTier: 'free',
					tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
					stripeSubscriptionId: null,
					...NEVER_TRIALED,
				},
			},
			{
				name: '体験期間中 (実効プランは有料相当。上限はまだ効かない)',
				input: {
					planTier: 'standard',
					tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
					stripeSubscriptionId: null,
					trialUsed: true,
					isTrialActive: true,
				},
			},
			{
				name: 'S2 課金中',
				input: {
					planTier: 'standard',
					tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
					stripeSubscriptionId: 'sub_active',
					...NEVER_TRIALED,
				},
			},
			{
				name: 'S3 支払い失敗猶予 (dunning 中。有料機能は維持される)',
				input: {
					planTier: 'standard',
					tenantStatus: SUBSCRIPTION_STATUS.GRACE_PERIOD,
					stripeSubscriptionId: 'sub_dunning',
					...NEVER_TRIALED,
				},
			},
			{
				name: 'S4 停止 (契約が残り、支払いが通れば有料に戻る)',
				input: {
					planTier: 'free',
					tenantStatus: SUBSCRIPTION_STATUS.SUSPENDED,
					stripeSubscriptionId: 'sub_unpaid',
					...NEVER_TRIALED,
				},
			},
			{
				name: 'S6 退会済 (hooks が画面到達前に遮断する。archive の対象ではない)',
				input: {
					planTier: 'free',
					tenantStatus: SUBSCRIPTION_STATUS.TERMINATED,
					stripeSubscriptionId: null,
					...NEVER_TRIALED,
				},
			},
		];

		for (const { name, input } of cases) {
			it(name, () => {
				expect(hasRevertedToFreePlan(input)).toBe(false);
			});
		}
	});
});
