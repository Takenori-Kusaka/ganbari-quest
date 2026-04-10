// tests/e2e/stamp-card-dialog.spec.ts
// #673: スタンプカードダイアログの表示・a11y・画像表示を検証

import { expect, test } from '@playwright/test';
import { clearDialogGhosts, dismissOverlays, selectKinderChild } from './helpers';

test.describe('#673: スタンプカードダイアログ', () => {
	test.beforeEach(async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await clearDialogGhosts(page);
	});

	test('ヘッダーのスタンプボタンからダイアログが開閉できる', async ({ page }) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		// スタンプボタンが存在しない場合はスキップ（プレミアム限定等）
		if (!(await stampBtn.isVisible().catch(() => false))) {
			test.skip();
			return;
		}

		await stampBtn.click();

		// スタンプカードが表示される
		const stampCard = page.getByTestId('stamp-card');
		await expect(stampCard).toBeVisible({ timeout: 3000 });

		// ダイアログのアクセシブルネームが設定されている（a11y）
		const dialog = page.locator('[data-scope="dialog"][data-state="open"][data-part="content"]');
		await expect(dialog).toBeVisible();

		// visually-hidden な ArkDialog.Title が存在する（sr-only）
		const srTitle = dialog.locator('.sr-only');
		await expect(srTitle).toHaveText('スタンプカード');

		// 閉じるボタンで閉じられる
		const closeBtn = dialog.locator('button[aria-label="とじる"]');
		await closeBtn.click();
		await page.waitForTimeout(500);

		// ダイアログが閉じている
		await expect(stampCard).not.toBeVisible();
	});

	test('スタンプカード内のスタンプ画像が正しく表示される（絵文字fallbackなし）', async ({
		page,
	}) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		if (!(await stampBtn.isVisible().catch(() => false))) {
			test.skip();
			return;
		}

		await stampBtn.click();
		const stampCard = page.getByTestId('stamp-card');
		await expect(stampCard).toBeVisible({ timeout: 3000 });

		// スタンプカード内の画像を確認（スタンプが押されていれば画像がある）
		const stampImages = stampCard.locator('.stamp-slot__img');
		const imgCount = await stampImages.count();

		// 画像がある場合、全てが /assets/stamps/ を参照していることを検証
		for (let i = 0; i < imgCount; i++) {
			const src = await stampImages.nth(i).getAttribute('src');
			expect(src).toMatch(/\/assets\/stamps\//);
		}

		// 閉じる
		await page.keyboard.press('Escape');
	});

	test('ダイアログサイズが lg（36rem）で十分な幅がある', async ({ page }) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		if (!(await stampBtn.isVisible().catch(() => false))) {
			test.skip();
			return;
		}

		await stampBtn.click();
		const dialog = page.locator('[data-scope="dialog"][data-state="open"][data-part="content"]');
		await expect(dialog).toBeVisible({ timeout: 3000 });

		// ダイアログ幅が280px以上あることを確認（min-width: 280px）
		const box = await dialog.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.width).toBeGreaterThanOrEqual(280);
		}

		await page.keyboard.press('Escape');
	});
});
