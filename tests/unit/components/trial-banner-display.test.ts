// tests/unit/components/trial-banner-display.test.ts
// TrialBanner の表示分岐（urgent 専用、#3033）
//
// #3033 (PO 指摘 2026-06-12) で TrialBanner は urgent (trial 残 1 日以下) 専用に縮小:
// - not-started (#777 / #2901 の開始導線 + 制限機能列挙) は全ページ常設がモバイルで
//   画面の半分を占め無料版ユーザーの不利益になるため撤去。開始導線は
//   /admin/subscription (SaasLicensePanel `subscription-start-trial-button`) に一本化
// - active (非 urgent) は header 残日数 pill (AdminLayout `header-trial-pill`) が代替
// - expired は一回限りの TrialEndedDialog (#770) + subscription ページ表示が代替
// 各代替経路の検証: AdminLayout.stories.svelte (pill) / trial-flow.spec.ts (E2E 貫通)

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TrialBanner from '../../../src/lib/features/admin/components/TrialBanner.svelte';

describe('TrialBanner 表示（#3033 urgent 専用）', () => {
	afterEach(() => {
		cleanup();
	});

	describe('urgent 状態（trial active + 残り 1 日以下）', () => {
		const props = { isTrialActive: true, daysRemaining: 1 };

		it('「明日で終了します」のタイトルと urgent バナーが表示される', () => {
			const { container } = render(TrialBanner, props);
			expect(screen.getByTestId('trial-banner-urgent')).toBeDefined();
			expect(document.body.textContent).toContain('明日で終了');
			const banner = container.querySelector('.trial-banner');
			expect(banner?.classList.contains('urgent')).toBe(true);
		});

		it('CTA（プランを見る）が /admin/subscription にリンクする', () => {
			render(TrialBanner, props);
			const cta = screen.getByTestId('trial-banner-active-cta');
			expect(cta.getAttribute('href')).toBe('/admin/subscription');
		});

		it('残り 0 日（当日）でも urgent バナーが表示される', () => {
			render(TrialBanner, { isTrialActive: true, daysRemaining: 0 });
			expect(screen.getByTestId('trial-banner-urgent')).toBeDefined();
		});
	});

	describe('非 urgent では何も描画されない', () => {
		it('trial active で残り 2 日以上はバナーなし（header pill が代替）', () => {
			const { container } = render(TrialBanner, { isTrialActive: true, daysRemaining: 7 });
			expect(container.querySelector('.trial-banner')).toBeNull();
		});

		it('trial 非 active ではバナーなし（開始導線は /admin/subscription）', () => {
			const { container } = render(TrialBanner, { isTrialActive: false, daysRemaining: 0 });
			expect(container.querySelector('.trial-banner')).toBeNull();
		});
	});
});
