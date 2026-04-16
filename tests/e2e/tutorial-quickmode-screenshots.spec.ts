import path from 'node:path';
import { test } from '@playwright/test';

// PR #961 / Issue #955: 親チュートリアル quickMode UI スクリーンショット取得
// - Desktop (1280x800) と Mobile (375x667) で AdminHome の「くわしいガイドを最初から見る」導線を撮影
// 出力: docs/screenshots/tutorial-quickmode/
const OUT_DIR = path.resolve('docs/screenshots/tutorial-quickmode');

async function prepareAdminPage(page: import('@playwright/test').Page) {
	await page.goto('/admin', { waitUntil: 'domcontentloaded' });
	await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });
	await page.evaluate(() => {
		localStorage.removeItem('tutorial-progress-chapter');
		localStorage.removeItem('tutorial-progress-step');
	});
	await page.waitForSelector('[data-testid="admin-view-full-guide"]', { timeout: 60_000 });
}

test.describe('tutorial quickMode screenshots', () => {
	test.setTimeout(180_000);

	test('Desktop AdminHome - 全ガイド導線カード', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await prepareAdminPage(page);
		await page.screenshot({
			path: path.join(OUT_DIR, 'desktop-adminhome-guide-card.png'),
			fullPage: true,
		});
	});

	test('Mobile AdminHome - 全ガイド導線カード', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await prepareAdminPage(page);
		await page.screenshot({
			path: path.join(OUT_DIR, 'mobile-adminhome-guide-card.png'),
			fullPage: true,
		});
	});
});
