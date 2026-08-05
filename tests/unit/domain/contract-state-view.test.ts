// tests/unit/domain/contract-state-view.test.ts
// #4156: 契約状態 × 表示文言 × 認可結果の対応を固定する fitness function (ADR-0061)。
//
// #4146 の統合で 2 件の退行が同時に出た。どちらも「画面の分岐」と「実挙動」が別ファイルにあり、
// 片方だけ変えても何も落ちなかったことが原因である:
//   - 退行 1: 請求導線を契約 (`stripeSubscriptionId`) で出し分け、寿命の違う
//             `stripeCustomerId` (過去の取引) まで巻き添えで隠した
//   - 退行 2: #3993 で認可の実挙動を「解約後も無料プラン相当で書き込み可」に変えたのに、
//             画面が「記録やポイントの付与はできません」と言い続けた
//
// 本 test は表 (`CONTRACT_STATE_VIEW`) が示す `licenseStatus` / `writesAllowed` を
// **実物の `deriveTenantEntitlement` / `authorizeCognito` で検算**し、同じ状態の文言が
// 実挙動と矛盾しないことを表明する。表・認可・文言のいずれか 1 つを変えると落ちる。

import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import {
	SUBSCRIPTION_STATUS,
	type SubscriptionStatus,
} from '$lib/domain/constants/subscription-status';
import {
	ALL_CONTRACT_STATES,
	CONTRACT_STATE,
	CONTRACT_STATE_VIEW,
	type ContractState,
	canOpenBillingHistory,
	hasActiveContract,
	resolveContractState,
	WRITE_DENIAL_PHRASES,
} from '$lib/domain/contract-state-view';
import { SUBSCRIPTION_PAGE_LABELS } from '$lib/domain/labels';
import { authorizeCognito } from '$lib/server/auth/authorization';
import type { Tenant } from '$lib/server/auth/entities';
import { deriveTenantEntitlement } from '$lib/server/auth/tenant-entitlement';

/** 各契約状態を表す `families` 行 (contract-state-matrix.md §4 の組み合わせ) */
const TENANT_FIXTURES: Record<
	ContractState,
	Pick<Tenant, 'status' | 'plan' | 'stripeCustomerId' | 'stripeSubscriptionId'> & {
		cancelAtPeriodEnd?: boolean;
	}
> = {
	// S1 未課金
	[CONTRACT_STATE.FREE]: { status: SUBSCRIPTION_STATUS.ACTIVE },
	// S2 課金中
	[CONTRACT_STATE.ACTIVE]: {
		status: SUBSCRIPTION_STATUS.ACTIVE,
		plan: SUBSCRIPTION_PLAN.MONTHLY,
		stripeCustomerId: 'cus_4156',
		stripeSubscriptionId: 'sub_4156',
	},
	// S2 + Stripe の cancel_at_period_end
	[CONTRACT_STATE.CANCEL_PENDING]: {
		status: SUBSCRIPTION_STATUS.ACTIVE,
		plan: SUBSCRIPTION_PLAN.MONTHLY,
		stripeCustomerId: 'cus_4156',
		stripeSubscriptionId: 'sub_4156',
		cancelAtPeriodEnd: true,
	},
	// S3 支払い失敗猶予
	[CONTRACT_STATE.GRACE_PERIOD]: {
		status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
		plan: SUBSCRIPTION_PLAN.MONTHLY,
		stripeCustomerId: 'cus_4156',
		stripeSubscriptionId: 'sub_4156',
	},
	// S4 停止 (契約は残る)
	[CONTRACT_STATE.PAYMENT_SUSPENDED]: {
		status: SUBSCRIPTION_STATUS.SUSPENDED,
		plan: SUBSCRIPTION_PLAN.MONTHLY,
		stripeCustomerId: 'cus_4156',
		stripeSubscriptionId: 'sub_4156',
	},
	// S5 契約終了 (TERMINAL_CONTRACT_STATE。stripeCustomerId は意図的に残る)
	[CONTRACT_STATE.CANCELLED]: {
		status: SUBSCRIPTION_STATUS.SUSPENDED,
		stripeCustomerId: 'cus_4156',
	},
};

/** 書き込みを伴う代表ルート (活動記録の API) */
const WRITE_ROUTE = '/api/v1/admin/activities';

function authorizeWrite(state: ContractState): boolean {
	const fixture = TENANT_FIXTURES[state];
	const entitlement = deriveTenantEntitlement({
		tenantId: 'tenant-4156',
		name: 'テスト家族',
		ownerId: 'owner-4156',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...fixture,
	} as Tenant);

	const result = authorizeCognito(
		WRITE_ROUTE,
		{ type: 'cognito', userId: 'owner-4156', email: 'owner@example.com' },
		{
			tenantId: 'tenant-4156',
			role: 'owner',
			licenseStatus: entitlement.licenseStatus,
			tenantStatus: entitlement.tenantStatus,
			plan: entitlement.plan,
		},
	);
	return result.allowed;
}

describe('#4156 契約状態 × 表示文言 × 認可結果', () => {
	it('resolveContractState が families 4 列 + cancel_at_period_end から状態を導く', () => {
		for (const state of ALL_CONTRACT_STATES) {
			expect(resolveContractState(TENANT_FIXTURES[state])).toBe(state);
		}
	});

	it('S6 (terminated = 退会) は本表の対象外', () => {
		expect(
			resolveContractState({ status: SUBSCRIPTION_STATUS.TERMINATED as SubscriptionStatus }),
		).toBeNull();
	});

	it('表が全状態を網羅している (no-silent-gap)', () => {
		expect(Object.keys(CONTRACT_STATE_VIEW).sort()).toEqual([...ALL_CONTRACT_STATES].sort());
	});

	describe.each(ALL_CONTRACT_STATES)('%s', (state) => {
		const view = CONTRACT_STATE_VIEW[state];

		it('表の licenseStatus が deriveTenantEntitlement の実結果と一致する', () => {
			const entitlement = deriveTenantEntitlement({
				tenantId: 'tenant-4156',
				name: 'テスト家族',
				ownerId: 'owner-4156',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				...TENANT_FIXTURES[state],
			} as Tenant);
			expect(entitlement.licenseStatus).toBe(view.licenseStatus);
		});

		it('表の writesAllowed が authorizeCognito の実結果と一致する', () => {
			expect(authorizeWrite(state)).toBe(view.writesAllowed);
		});

		it('顧客に見せる文言が認可の実挙動と矛盾しない', () => {
			const texts = [
				...view.customerFacingTexts,
				...(view.statusNotice ? [view.statusNotice.desc] : []),
			];

			for (const text of texts) {
				const denials = WRITE_DENIAL_PHRASES.filter((phrase) => text.includes(phrase));
				if (view.writesAllowed) {
					// 書けるのに「できません」と書いてはならない (ADR-0013 / 退行 2 の再発)
					expect(denials, `writesAllowed なのに制限表現を含む: ${text}`).toEqual([]);
				} else {
					// 書けないなら、その事実を必ず伝える (制限を黙って隠さない)
					expect(
						denials.length,
						`writesAllowed=false なのに制限表現が無い: ${text}`,
					).toBeGreaterThan(0);
				}
			}
		});

		it('書き込みが許可されている状態の告知には記録継続の保証文が入る', () => {
			if (!view.statusNotice || !view.writesAllowed) return;
			expect(view.statusNotice.desc).toContain(SUBSCRIPTION_PAGE_LABELS.writesContinueAssurance);
		});
	});

	describe('請求履歴 (過去の取引) の到達性は契約の有無から独立している', () => {
		it('解約済み (契約なし・顧客あり) でも請求履歴に到達できる', () => {
			const cancelled = TENANT_FIXTURES[CONTRACT_STATE.CANCELLED];
			expect(hasActiveContract(cancelled)).toBe(false);
			expect(canOpenBillingHistory(cancelled)).toBe(true);
		});

		it('一度も取引が無ければ請求履歴は無い', () => {
			expect(canOpenBillingHistory(TENANT_FIXTURES[CONTRACT_STATE.FREE])).toBe(false);
		});

		it('契約の有無で請求履歴の到達性が変わらない (退行 1 の class-lock)', () => {
			const withContract = { stripeCustomerId: 'cus_4156', stripeSubscriptionId: 'sub_4156' };
			const withoutContract = { stripeCustomerId: 'cus_4156', stripeSubscriptionId: null };
			expect(hasActiveContract(withContract)).not.toBe(hasActiveContract(withoutContract));
			expect(canOpenBillingHistory(withContract)).toBe(canOpenBillingHistory(withoutContract));
		});
	});
});
