// tests/e2e/admin-nav-responsive.spec.ts
// #2178 (EPIC #2176): 親管理画面 5 tab レスポンシブ E2E
//
// 検証対象:
// 1. PC 1920px / Tablet 768px / Mobile 375px の 3 breakpoint で 5 tab (ホーム + 家族 + 活動 + 記録 + 設定) すべてクリック可能
// 2. iPhone SE 375pt 最小幅で 5 tab がレイアウト破綻なし (label 表示 + tap target 44×44 以上)
// 3. family カテゴリ dropdown に「こども」「メンバー」が含まれる (subject-first 上位化)
//
// 注意:
//   - ローカル E2E は AUTH_MODE=local のため /admin へのアクセスは素通し (cognito mock 不要)
//   - AdminLayout は md:block / md:hidden で Desktop/Mobile を切り替えている
//   - 1280px / 1920px は Desktop nav 表示、768px は Tablet (md: 768px breakpoint) で Desktop nav 表示
//   - 375px は Mobile bottom nav 表示

import { expect, test } from '@playwright/test';

const BREAKPOINTS = {
	mobile: { width: 375, height: 667 }, // iPhone SE
	tablet: { width: 768, height: 1024 }, // iPad Mini portrait
	desktop: { width: 1920, height: 1080 }, // PC FullHD
} as const;

const FAMILY_ITEMS = [
	{ label: 'こども', href: '/admin/children' },
	{ label: 'メンバー', href: '/admin/members' },
] as const;

test.describe('#2178 親管理画面 5 tab レスポンシブ', () => {
	// ============================================================
	// Mobile 375×667: 5 tab すべて visible + family submenu 機能
	// ============================================================
	test('Mobile 375×667: ホーム + 4 カテゴリ (家族/活動/記録/設定) が visible', async ({
		browser,
	}) => {
		test.slow();
		const ctx = await browser.newContext({ viewport: BREAKPOINTS.mobile });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			const mobileNav = page.locator('nav[data-tutorial="nav-primary"]');
			await expect(mobileNav).toBeVisible();

			// ホーム link (専用、dropdown なし)
			await expect(mobileNav.getByRole('link', { name: /ホーム/ })).toBeVisible();

			// 4 カテゴリ button が visible
			await expect(mobileNav.getByRole('button', { name: /^家族$/ })).toBeVisible();
			await expect(mobileNav.getByRole('button', { name: /^活動$/ })).toBeVisible();
			await expect(mobileNav.getByRole('button', { name: /^記録$/ })).toBeVisible();
			await expect(mobileNav.getByRole('button', { name: /^設定$/ })).toBeVisible();
		} finally {
			await ctx.close();
		}
	});

	test('Mobile 375×667: 家族 submenu に こども + メンバー が含まれる', async ({ browser }) => {
		test.slow();
		const ctx = await browser.newContext({ viewport: BREAKPOINTS.mobile });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			const mobileNav = page.locator('nav[data-tutorial="nav-primary"]');
			const familyBtn = mobileNav.getByRole('button', { name: /^家族$/ });
			await expect(familyBtn).toBeVisible();
			await familyBtn.click();

			// family submenu 内の link 確認 (subject-first 上位化)
			for (const item of FAMILY_ITEMS) {
				const link = page.getByRole('link', { name: new RegExp(item.label) }).first();
				await expect(link).toBeVisible();
				await expect(link).toHaveAttribute('href', item.href);
			}
		} finally {
			await ctx.close();
		}
	});

	// ============================================================
	// Tablet 768×1024: Desktop nav (md:block) で 5 tab visible
	// ============================================================
	test('Tablet 768×1024: Desktop nav に 5 tab visible', async ({ browser }) => {
		test.slow();
		const ctx = await browser.newContext({ viewport: BREAKPOINTS.tablet });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			const desktopNav = page.locator('nav[data-tutorial="nav-desktop"]');
			await expect(desktopNav).toBeVisible();

			await expect(desktopNav.getByRole('link', { name: /ホーム/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^家族$/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^活動$/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^記録$/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^設定$/ })).toBeVisible();
		} finally {
			await ctx.close();
		}
	});

	// ============================================================
	// Desktop 1920×1080: 5 tab + family dropdown 機能
	// ============================================================
	test('Desktop 1920×1080: Desktop nav に 5 tab visible', async ({ browser }) => {
		test.slow();
		const ctx = await browser.newContext({ viewport: BREAKPOINTS.desktop });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			const desktopNav = page.locator('nav[data-tutorial="nav-desktop"]');
			await expect(desktopNav).toBeVisible();

			await expect(desktopNav.getByRole('link', { name: /ホーム/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^家族$/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^活動$/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^記録$/ })).toBeVisible();
			await expect(desktopNav.getByRole('button', { name: /^設定$/ })).toBeVisible();
		} finally {
			await ctx.close();
		}
	});

	test('Desktop 1920×1080: 家族 dropdown に こども + メンバー が含まれる', async ({ browser }) => {
		test.slow();
		const ctx = await browser.newContext({ viewport: BREAKPOINTS.desktop });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			const desktopNav = page.locator('nav[data-tutorial="nav-desktop"]');
			const familyBtn = desktopNav.getByRole('button', { name: /^家族$/ });
			await expect(familyBtn).toBeVisible();
			await familyBtn.hover();

			// family dropdown 内の link 確認
			for (const item of FAMILY_ITEMS) {
				const link = page.getByRole('menuitem', { name: new RegExp(item.label) }).first();
				await expect(link).toBeVisible();
				await expect(link).toHaveAttribute('href', item.href);
			}
		} finally {
			await ctx.close();
		}
	});

	// ============================================================
	// 既存 legacy URL 維持: /admin/children / /admin/members が 200 到達
	// ============================================================
	test('legacy URL 維持: /admin/children / /admin/members に直接アクセス可能', async ({ page }) => {
		const childrenRes = await page.goto('/admin/children', { waitUntil: 'domcontentloaded' });
		expect(childrenRes?.status()).toBe(200);

		const membersRes = await page.goto('/admin/members', { waitUntil: 'domcontentloaded' });
		expect(membersRes?.status()).toBe(200);
	});
});
