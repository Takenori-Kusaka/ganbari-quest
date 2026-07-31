// tests/unit/components/plan-status-card-upgrade-cta.test.ts
// PlanStatusCard のアップグレード CTA が「自ページを指すリンク」にならないこと (#4139)
//
// #4139 (本番実機 2026-07-31 PO 確認): /admin/subscription 上の PlanStatusCard の
// 「プランの詳細」「⭐⭐ プレミアムへ」がどちらも自ページ (/admin/subscription) を指しており、
// 押しても何も起きない = スタンダード → プレミアムのアップグレード導線が死んでいた。
//
// 原因は、PlanStatusCard が onUpgrade コールバック未指定時に
// `href="{basePath}/subscription"` の <a> にフォールバックする実装で、
// プランページ自身 (SaasLicensePanel) がコールバックを渡していなかったこと。
//
// 本テストは「コールバックがあるときは自ページリンクを一切描画せず、
// 実処理 (Stripe checkout / portal) を起動する操作要素になる」ことを固定する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_PLAN } from '../../../src/lib/domain/constants/subscription-plan';
import PlanStatusCard from '../../../src/lib/features/admin/components/PlanStatusCard.svelte';

const SELF_LINK = '/admin/subscription';

describe('PlanStatusCard アップグレード CTA (#4139)', () => {
	afterEach(() => {
		cleanup();
	});

	describe('プランページ上 (onUpgrade 指定あり) — 自ページリンクを描画しない', () => {
		it('standard: プレミアムへの CTA が onUpgrade を呼び、自ページ <a> が存在しない', async () => {
			const onUpgrade = vi.fn();
			const { container } = render(PlanStatusCard, { planTier: 'standard', onUpgrade });

			// 自ページを指す <a> が 1 本も無いこと (「プランの詳細」も自ページのため不可)
			expect(container.querySelectorAll(`a[href="${SELF_LINK}"]`).length).toBe(0);

			const cta = screen.getByTestId('plan-status-family-cta');
			expect(cta.tagName).toBe('BUTTON');
			cta.click();
			expect(onUpgrade).toHaveBeenCalledWith(SUBSCRIPTION_PLAN.FAMILY_MONTHLY);
		});

		it('free: アップグレード CTA が onUpgrade を呼び、自ページ <a> が存在しない', async () => {
			const onUpgrade = vi.fn();
			const { container } = render(PlanStatusCard, { planTier: 'free', onUpgrade });

			expect(container.querySelectorAll(`a[href="${SELF_LINK}"]`).length).toBe(0);

			const cta = screen.getByTestId('plan-status-free-cta');
			expect(cta.tagName).toBe('BUTTON');
			cta.click();
			expect(onUpgrade).toHaveBeenCalledWith(SUBSCRIPTION_PLAN.MONTHLY);
		});

		it('トライアル中: 本契約 CTA が onUpgrade を呼び、自ページ <a> が存在しない', async () => {
			const onUpgrade = vi.fn();
			const { container } = render(PlanStatusCard, {
				planTier: 'free',
				onUpgrade,
				trialStatus: {
					isTrialActive: true,
					trialUsed: false,
					daysRemaining: 3,
					trialEndDate: null,
					trialTier: 'standard',
				},
			});

			expect(container.querySelectorAll(`a[href="${SELF_LINK}"]`).length).toBe(0);

			const cta = screen.getByTestId('plan-status-trial-cta');
			expect(cta.tagName).toBe('BUTTON');
			cta.click();
			expect(onUpgrade).toHaveBeenCalledWith(SUBSCRIPTION_PLAN.MONTHLY);
		});

		it('処理中 (upgradeLoading) は CTA が disabled で二重起動しない', async () => {
			const onUpgrade = vi.fn();
			render(PlanStatusCard, { planTier: 'standard', onUpgrade, upgradeLoading: true });

			const cta = screen.getByTestId('plan-status-family-cta') as HTMLButtonElement;
			expect(cta.disabled).toBe(true);
			cta.click();
			expect(onUpgrade).not.toHaveBeenCalled();
		});
	});

	describe('プランページ以外 (onUpgrade 未指定) — プランページへのリンクとして機能する', () => {
		it('standard: プランページへの <a> リンクになる', () => {
			render(PlanStatusCard, { planTier: 'standard' });
			const cta = screen.getByTestId('plan-status-family-cta');
			expect(cta.tagName).toBe('A');
			expect(cta.getAttribute('href')).toBe(SELF_LINK);
		});

		it('free: プランページへの <a> リンクになる', () => {
			render(PlanStatusCard, { planTier: 'free' });
			const cta = screen.getByTestId('plan-status-free-cta');
			expect(cta.tagName).toBe('A');
			expect(cta.getAttribute('href')).toBe(SELF_LINK);
		});
	});
});
