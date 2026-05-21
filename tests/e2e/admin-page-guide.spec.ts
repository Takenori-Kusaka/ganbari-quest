// tests/e2e/admin-page-guide.spec.ts
// #2375 (PR #2388): PageHelpButton v1 撤去 + PageGuide v2 統一の回帰テスト。
//
// 6 admin 画面 (activities / cheer / children / points / rewards / reports) で:
// 1. グローバル ❓ ボタン (`[data-tutorial="page-guide-btn"]`) が 1 個のみ表示される
// 2. PageHelpButton v1 (`[data-testid="page-help-btn"]`) が 0 個 (物理撤去)
// 3. ❓ click で PageGuideOverlay v2 が起動
// 4. v1 TutorialOverlay は起動しない (.tutorial-overlay 不在)
// 5. PageGuideOverlay の role / aria 属性が正しい (AC-V2-7)
//
// 実行: npx playwright test tests/e2e/admin-page-guide.spec.ts

import { expect, test } from '@playwright/test';

/** 6 admin 画面 (Issue #2375 で物理撤去対象の PageHelpButton 使用画面) */
const ADMIN_PAGES = [
	{ path: '/admin/activities', name: 'activities' },
	{ path: '/admin/cheer', name: 'cheer' },
	{ path: '/admin/children', name: 'children' },
	{ path: '/admin/points', name: 'points' },
	{ path: '/admin/rewards', name: 'rewards' },
	{ path: '/admin/reports', name: 'reports' },
] as const;

async function dismissWelcome(page: import('@playwright/test').Page) {
	const welcomeDialog = page.locator('.welcome-overlay');
	if (await welcomeDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
		const dismissBtn = welcomeDialog.locator('button:has-text("さっそく始める")');
		if (await dismissBtn.isVisible().catch(() => false)) {
			await dismissBtn.click();
			await welcomeDialog.waitFor({ state: 'hidden', timeout: 3000 });
		}
	}
}

test.describe('#2375 admin 6 画面の PageGuide v2 統一', () => {
	test.setTimeout(60_000);

	for (const { path, name } of ADMIN_PAGES) {
		test(`${name}: ❓ ボタン 1 個 + PageHelpButton v1 不在 + PageGuide v2 起動可`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(path);
			await dismissWelcome(page);

			// AC: グローバル ❓ ボタン (page-guide-btn) が 1 個のみ
			const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
			await expect(pageGuideBtn).toHaveCount(1);
			await expect(pageGuideBtn).toBeVisible();

			// AC: PageHelpButton v1 が 0 個 (物理撤去確認)
			await expect(page.locator('[data-testid="page-help-btn"]')).toHaveCount(0);

			// AC: ❓ click で PageGuideOverlay v2 が起動
			await pageGuideBtn.click();
			const guideOverlay = page.locator('.guide-overlay');
			await expect(guideOverlay).toBeVisible({ timeout: 10_000 });

			// AC-V2-7: role / aria 属性が正しい
			await expect(guideOverlay).toHaveAttribute('role', 'dialog');
			await expect(guideOverlay).toHaveAttribute('aria-modal', 'true');
			await expect(guideOverlay).toHaveAttribute('aria-labelledby', 'page-guide-title');

			// AC: v1 TutorialOverlay は同時 active にならない (AC-V2-5)
			await expect(page.locator('.tutorial-overlay')).toHaveCount(0);

			// AC: 起動した PageGuideOverlay の bubble が 1 個のみ
			const guideBubble = page.locator('.guide-bubble');
			await expect(guideBubble).toHaveCount(1);
		});
	}
});
