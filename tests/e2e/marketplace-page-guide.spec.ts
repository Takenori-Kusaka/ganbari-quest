// tests/e2e/marketplace-page-guide.spec.ts
// #3263 (EPIC #3260 F2): marketplace にページガイド機構を配線 (? trigger + PageGuideOverlay)。
//
// marketplace は AdminLayout 非使用のため独自配線 (marketplace/+layout.svelte)。
// 検証する機構 (admin-page-guide.spec.ts と同型、open → act → outcome):
// 1. /marketplace 一覧で ❓ ボタン (`[data-tutorial="page-guide-btn"]`) が 1 個表示される
// 2. ❓ click で PageGuideOverlay (.guide-overlay) が開く (role/aria 属性正しい)
// 3. 「とじる」(.guide-nav-end) で PageGuideOverlay が閉じる (dead-end でない)
// 4. 詳細ルート /marketplace/<type>/<itemId> でも親フォールバックで ❓ が機能する
//
// 実行: npx playwright test tests/e2e/marketplace-page-guide.spec.ts

import { expect, test } from '@playwright/test';

test.describe('#3263 marketplace ページガイド機構', () => {
	test.setTimeout(60_000);

	test('一覧: ❓ が表示され、開いて閉じられる (機構配線が機能する)', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/marketplace');

		// 1. ❓ ボタンが 1 個表示される。
		// ガイド解決は registry の動的 import 後に hasPageGuide を立てる非同期処理のため、
		// 初回 dev コンパイル分を見込んで余裕のある timeout で待つ (CI preview ではほぼ即時)。
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		await expect(pageGuideBtn).toBeVisible({ timeout: 15_000 });
		await expect(pageGuideBtn).toHaveCount(1);

		// 2. ❓ click で PageGuideOverlay が開く (open → act → outcome)
		await pageGuideBtn.click();
		const guideOverlay = page.locator('.guide-overlay');
		await expect(guideOverlay).toBeVisible({ timeout: 10_000 });
		await expect(guideOverlay).toHaveAttribute('role', 'dialog');
		await expect(guideOverlay).toHaveAttribute('aria-modal', 'true');
		await expect(guideOverlay).toHaveAttribute('aria-labelledby', 'page-guide-title');

		// 起動した bubble は 1 個のみ (= marketplace ガイドが解決されている)
		const guideBubble = page.locator('.guide-bubble');
		await expect(guideBubble).toHaveCount(1);

		// 3. 「とじる」で閉じられる (dead-end でないことを検証)
		await page.locator('.guide-nav-end').click();
		await expect(guideOverlay).toHaveCount(0);
	});

	test('詳細: 親フォールバックで ❓ が機能する (open → act → outcome)', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		// 一覧から最初のテンプレート詳細へ遷移 (固定 itemId に依存しない)
		await page.goto('/marketplace');
		const firstItem = page.locator('a[href^="/marketplace/"]').first();
		await expect(firstItem).toBeVisible({ timeout: 10_000 });
		await firstItem.click();
		await page.waitForURL(/\/marketplace\/[^/]+\/[^/]+/);

		// 詳細ルートでも ❓ が出る (親 /marketplace ガイドへフォールバック)
		const pageGuideBtn = page.locator('[data-tutorial="page-guide-btn"]');
		await expect(pageGuideBtn).toBeVisible({ timeout: 15_000 });
		await expect(pageGuideBtn).toHaveCount(1);

		await pageGuideBtn.click();
		const guideOverlay = page.locator('.guide-overlay');
		await expect(guideOverlay).toBeVisible({ timeout: 10_000 });

		// 閉じられる (dead-end でない)
		await page.locator('.guide-nav-end').click();
		await expect(guideOverlay).toHaveCount(0);
	});
});
