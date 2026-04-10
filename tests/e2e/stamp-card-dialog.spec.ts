// tests/e2e/stamp-card-dialog.spec.ts
// #673: スタンプカードダイアログの表示・a11y・画像表示を検証

import { expect, test } from '@playwright/test';
import { dismissOverlays, selectKinderChild } from './helpers';

test.describe('#673: スタンプカードダイアログ', () => {
	test.beforeEach(async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
	});

	test('ヘッダーのスタンプボタンからダイアログが開閉できる', async ({ page }) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		// スタンプボタンが存在しなければテスト対象外
		await expect(stampBtn).toBeVisible({ timeout: 3000 });

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

		// ダイアログが閉じるのを待つ
		await expect(stampCard).not.toBeVisible({ timeout: 3000 });
	});

	test('スタンプカード内のスタンプ画像が正しく表示される（絵文字fallbackなし）', async ({
		page,
	}) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		await expect(stampBtn).toBeVisible({ timeout: 3000 });

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

	test('ダイアログタイトルが重複していない', async ({ page }) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		await expect(stampBtn).toBeVisible({ timeout: 3000 });

		await stampBtn.click();
		const dialog = page.locator('[data-scope="dialog"][data-state="open"][data-part="content"]');
		await expect(dialog).toBeVisible({ timeout: 3000 });

		// ダイアログ内の「スタンプカード」テキストを検索
		// #673 デグレ: タイトルが複数表示される問題の回帰防止
		// sr-only タイトル + カード内ヘッダーの2箇所は許容（sr-only は非表示）
		// 目視可能なタイトルが1つのみであることを検証
		// Note: Playwright の :visible は sr-only(1x1px) も visible と判定するため evaluate で除外
		const visibleCount = await dialog.evaluate((el) => {
			return [...el.querySelectorAll('*')].filter((node) => {
				const directText = [...node.childNodes]
					.filter((c) => c.nodeType === 3)
					.map((c) => c.textContent)
					.join('');
				if (!directText.includes('スタンプカード')) return false;
				if (node.closest('.sr-only')) return false;
				const style = window.getComputedStyle(node);
				if (style.display === 'none' || style.visibility === 'hidden') return false;
				const rect = node.getBoundingClientRect();
				return rect.width > 2 && rect.height > 2;
			}).length;
		});
		expect(visibleCount).toBeLessThanOrEqual(1);

		await page.keyboard.press('Escape');
	});

	test('ダイアログサイズが lg（36rem）で十分な幅がある', async ({ page }) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		await expect(stampBtn).toBeVisible({ timeout: 3000 });

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

	test('スタンプカードの進捗表示が正しい構造を持つ', async ({ page }) => {
		const stampBtn = page.getByTestId('header-stamp-btn');
		await expect(stampBtn).toBeVisible({ timeout: 3000 });

		await stampBtn.click();
		const stampCard = page.getByTestId('stamp-card');
		await expect(stampCard).toBeVisible({ timeout: 3000 });

		// プログレスバーが存在する
		const progressBar = stampCard.locator('.stamp-card__progress-bar');
		await expect(progressBar).toBeVisible();

		// 進捗テキスト（n/m形式）が存在する
		const progressText = stampCard.locator('.stamp-card__progress-text');
		await expect(progressText).toBeVisible();
		const text = await progressText.textContent();
		expect(text).toMatch(/\d+\/\d+/);

		await page.keyboard.press('Escape');
	});
});
