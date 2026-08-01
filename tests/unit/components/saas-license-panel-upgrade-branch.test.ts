// tests/unit/components/saas-license-panel-upgrade-branch.test.ts
// アップグレード CTA の 3 分岐を、分岐を決める 2 変数ごとに固定する (#4161)
//
// #4139 の受け入れテスト (upgrade-flow.spec.ts) は「起こりうる結末を or で並べる」形で書かれており、
// どの環境でどちらの分岐が走るかを宣言していなかった。実測すると cognito-dev レーンでは
// `hasSubscription` が **常に false** で (sqlite の auth repo が stub テナントを返すため、
// `src/lib/server/db/sqlite/auth-repo.ts:22-32` — `stripeSubscriptionId` を持たない)、
// 契約ありの portal 分岐は E2E では原理的に到達できない。
//
// そこで分岐の検証は本 component 層に降ろす (ADR-0061 push-down-pyramid)。
// ここでは env にも secrets にも依存せず、3 分岐すべてが決定的に走る。
//
// 分岐 SSOT: SaasLicensePanel.svelte `handlePlanUpgrade`
//   (a) stripeEnabled=false          → 理由を提示して打ち切る (確認ダイアログを開かない、#4161 AC5)
//   (b) stripeEnabled=true  + 契約あり → requestPortal() → 請求管理ページ確認ダイアログ
//   (c) stripeEnabled=true  + 契約なし → startCheckout() → POST /api/stripe/checkout → 離脱

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_PLAN } from '../../../src/lib/domain/constants/subscription-plan';
import { SUBSCRIPTION_STATUS } from '../../../src/lib/domain/constants/subscription-status';
import { SUBSCRIPTION_PAGE_LABELS } from '../../../src/lib/domain/labels';
import SaasLicensePanel from '../../../src/lib/features/admin/components/SaasLicensePanel.svelte';

const NOW = '2026-08-01T00:00:00.000Z';

function buildData(options: { stripeEnabled: boolean; hasSubscription: boolean }) {
	return {
		license: {
			plan: 'standard_monthly',
			status: SUBSCRIPTION_STATUS.ACTIVE,
			tenantName: 'テスト家族',
			createdAt: NOW,
			updatedAt: NOW,
			// 契約ありの唯一の判定材料 (SaasLicensePanel: `!!license.stripeSubscriptionId`)
			stripeSubscriptionId: options.hasSubscription ? 'sub_test_4161' : undefined,
		},
		stripeEnabled: options.stripeEnabled,
		planTier: 'standard' as const,
		planStats: {
			activityCount: 1,
			activityMax: null,
			childCount: 1,
			childMax: null,
			retentionDays: 365,
		},
		trialStatus: {
			isTrialActive: false,
			trialUsed: true,
			daysRemaining: 0,
			trialEndDate: null,
			trialTier: 'standard' as const,
		},
		pinConfigured: false,
		downgradeRetentionDays: 90,
		cancellation: null,
		loyaltyInfo: null,
	};
}

/**
 * 請求管理ページの確認ダイアログが「開いている」か。
 *
 * Ark UI の Dialog は閉じていても content を DOM に残す (`hidden` + `data-state="closed"`)。
 * 存在の有無で判定すると、開いていないのに開いた扱いになる / 開いても気付けない、の両方が起きる
 * (CI で `toBeVisible` が "locator resolved to <button…> unexpected value hidden" と報告していたのと同じ状態)。
 */
function isPortalDialogOpen(): boolean {
	const btn = screen.queryByTestId('portal-confirm-button');
	const content = btn?.closest('[data-part="content"]');
	if (!content) return false;
	return content.getAttribute('data-state') === 'open' && !content.hasAttribute('hidden');
}

/** プランページ上の「プレミアムへ」CTA (PlanStatusCard 経由で handlePlanUpgrade を呼ぶ唯一の入口) */
function clickUpgradeCta() {
	const cta = screen.getByTestId('plan-status-family-cta');
	expect(cta.tagName).toBe('BUTTON');
	cta.click();
}

describe('SaasLicensePanel アップグレード CTA の分岐 (#4161)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('分岐を決める 2 変数が DOM に出ている (テストが前提を読める)', () => {
		render(SaasLicensePanel, {
			data: buildData({ stripeEnabled: true, hasSubscription: true }),
		});
		const panel = screen.getByTestId('saas-license-panel');
		expect(panel.getAttribute('data-stripe-enabled')).toBe('true');
		expect(panel.getAttribute('data-has-subscription')).toBe('true');
	});

	it('(a) 決済未設定: 確認ダイアログを開かず、理由を画面に出す', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		render(SaasLicensePanel, {
			data: buildData({ stripeEnabled: false, hasSubscription: true }),
		});

		clickUpgradeCta();

		// 理由が画面に出る (silent no-op にしない)
		await waitFor(() => {
			expect(screen.getByTestId('billing-unavailable-alert').textContent).toContain(
				SUBSCRIPTION_PAGE_LABELS.billingUnavailable,
			);
		});
		// PIN 付き確認ダイアログは開かない = 確定して失敗する dead-end を作らない (#2544 型)
		expect(isPortalDialogOpen()).toBe(false);
		// checkout も叩かない
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('(b) 決済有効 + 契約あり: 請求管理ページの確認ダイアログが開く', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		render(SaasLicensePanel, {
			data: buildData({ stripeEnabled: true, hasSubscription: true }),
		});

		clickUpgradeCta();

		await waitFor(() => {
			expect(isPortalDialogOpen()).toBe(true);
		});
		expect(screen.queryByTestId('billing-unavailable-alert')).toBeNull();
		// 契約ありは checkout を叩かない (409 ALREADY_SUBSCRIBED になる経路には行かない)
		expect(fetchSpy).not.toHaveBeenCalledWith(
			'/api/stripe/checkout',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('(c) 決済有効 + 契約なし: checkout session の作成を要求する', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_4161' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		render(SaasLicensePanel, {
			data: buildData({ stripeEnabled: true, hasSubscription: false }),
		});

		clickUpgradeCta();

		await waitFor(() => {
			expect(fetchSpy).toHaveBeenCalledWith(
				'/api/stripe/checkout',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ planId: SUBSCRIPTION_PLAN.FAMILY_MONTHLY }),
				}),
			);
		});
		// 契約なしで確認ダイアログが開いたら経路違い (portal は 契約ありのみ)
		expect(isPortalDialogOpen()).toBe(false);
		expect(screen.queryByTestId('billing-unavailable-alert')).toBeNull();
	});
});
