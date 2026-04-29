// tests/e2e/admin-nav-marketplace.spec.ts
// #1170: マケプレをグローバルナビに昇格した導線の E2E 検証
//
// 検証対象:
// 1. /marketplace は認証不要のパブリックルート (ADR-0036) として 200 で開ける
// 2. 管理画面 (/admin) の「活動」カテゴリ submenu に nav-marketplace が含まれる (#1396 で customize→activity に変更)
//    (Desktop: hover で dropdown を開く / Mobile 375x667: category button tap で submenu を開く)
//
// 履歴:
//   - LP (site/index.html, site/pricing.html) の header-nav に lp-nav-marketplace が含まれる検証は、
//     #1636 R32 「NAV 構成の全ページ統一 (home/pricing/faq/login/signup)」で marketplace を意図的に
//     LP NAV から外したため削除済み（PR #1673, Phase 4 LP 仕上げ）。
//     LP→マケプレ動線は本文セクション・パンフ経由に移行。再検証が必要なら別 Issue で扱う。
//
// 注意:
//   - ローカル E2E は AUTH_MODE=local のため /admin へのアクセスは素通し (cognito mock 不要)
//   - Mobile viewport では `tests/e2e/helpers.ts` 流の testid ベースのセレクタを使用

import { expect, test } from '@playwright/test';

test.describe('#1170 マケプレ グローバルナビ導線', () => {
	// ============================================================
	// 1. /marketplace は認証不要で開ける (ADR-0036)
	// ============================================================
	test('/marketplace がパブリックルートとして 200 で開ける', async ({ page }) => {
		const response = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(200);
		// マケプレのページ本体が描画されていることを軽く確認
		await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
	});

	// ============================================================
	// 2. 管理画面 Desktop: 活動 dropdown に nav-marketplace が含まれる
	// AdminLayout は md:block / md:hidden で Desktop/Mobile を切り替えているため、
	// mobile project のデフォルト viewport では `nav[data-tutorial="nav-desktop"]` が hidden。
	// `browser.newContext` で明示的に 1280x800 を作ることで、どの project でも Desktop viewport を保証する。
	// ============================================================
	test('Desktop 管理画面: 活動 dropdown に nav-marketplace が visible', async ({ browser }) => {
		test.slow(); // Vite dev cold compile
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			// 「活動」カテゴリボタンを hover して dropdown を開く
			// navCategories[].id === 'activity' / label は NAV_CATEGORIES.activity.label
			const desktopNav = page.locator('nav[data-tutorial="nav-desktop"]');
			await expect(desktopNav).toBeVisible();

			const activityBtn = desktopNav.getByRole('button', { name: /^活動$/ });
			await expect(activityBtn).toBeVisible();
			await activityBtn.hover();

			// dropdown 内の nav-marketplace link
			const marketplaceLink = page.getByTestId('nav-marketplace');
			await expect(marketplaceLink).toBeVisible();
			await expect(marketplaceLink).toHaveAttribute('href', '/marketplace');
		} finally {
			await ctx.close();
		}
	});

	// ============================================================
	// 3. 管理画面 Mobile (375x667): 活動 submenu に nav-marketplace-mobile が含まれる
	// ============================================================
	test('Mobile 375x667 管理画面: 活動 submenu に nav-marketplace-mobile が visible', async ({
		browser,
	}) => {
		test.slow();
		const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			// Mobile bottom nav — 活動 category button
			const mobileNav = page.locator('nav[data-tutorial="nav-primary"]');
			await expect(mobileNav).toBeVisible();
			const activityBtn = mobileNav.getByRole('button', { name: /^活動$/ });
			await expect(activityBtn).toBeVisible();
			await activityBtn.click();

			// submenu 内の nav-marketplace-mobile link
			const marketplaceLink = page.getByTestId('nav-marketplace-mobile');
			await expect(marketplaceLink).toBeVisible();
			await expect(marketplaceLink).toHaveAttribute('href', '/marketplace');
		} finally {
			await ctx.close();
		}
	});

	// ============================================================
	// 4-5. LP /index.html, /pricing.html: lp-nav-marketplace の visibility 検証は
	// #1636 R32「NAV 構成の全ページ統一 (home/pricing/faq)」で marketplace を
	// LP NAV から外したため削除済み（PR #1673, Phase 4 LP 仕上げ）。
	// LP→マケプレ動線は本文セクション・パンフ経由に移行。
	// ============================================================
});
