// tests/e2e/marketplace-filter.spec.ts
// #1171: マーケットプレイス フィルタ UI 刷新の E2E 検証
//
// AC 検証対象:
// - 年齢フィルタが age-tier 5 モード (baby/preschool/elementary/junior/senior) で動作する
// - 性別フィルタ (boy/girl/neutral) が URL クエリ `?gender=xxx` に反映される
// - 並び替え Select で URL クエリ `?sort=newest` 等に反映される
// - 件数表示 `[data-testid="result-count"]` が数値を含む
// - モバイル (375×667) で `[data-testid="filter-open-button"]` が表示される
// - リセット CTA で全クエリが消える
// - labels.ts SSOT: `'性別'` 等のハードコード文字列が画面描画時に正しいラベルとして出る

import { expect, test } from '@playwright/test';

test.describe('#1171 Marketplace filter UI', () => {
	test('年齢フィルタ (preschool) で URL クエリ `?age=preschool` が付く', async ({ page }) => {
		await page.goto('/marketplace');
		await page.locator('[data-testid="filter-age-preschool"]').first().click();
		await expect(page).toHaveURL(/[?&]age=preschool\b/);
	});

	test('性別フィルタ (boy) で URL クエリ `?gender=boy` が付く', async ({ page }) => {
		await page.goto('/marketplace');
		await page.locator('[data-testid="filter-gender-boy"]').first().click();
		await expect(page).toHaveURL(/[?&]gender=boy\b/);
	});

	test('件数表示が数値 + "件" を含む', async ({ page }) => {
		await page.goto('/marketplace');
		const count = await page.locator('[data-testid="result-count"]').first().textContent();
		expect(count?.trim() ?? '').toMatch(/^\d+件$/);
	});

	test('リセット CTA 押下で全クエリが消える', async ({ page }) => {
		await page.goto('/marketplace?age=elementary&gender=girl');
		await page.locator('[data-testid="filter-reset"]').first().click();
		await expect(page).toHaveURL(/\/marketplace\/?$/);
	});

	test('年齢フィルタのラベルは内部コード (kinder/preschool 等) を露出しない', async ({
		page,
	}) => {
		await page.goto('/marketplace');
		const desktopPanel = page.locator('[data-testid="filter-panel-desktop"]').first();
		const text = (await desktopPanel.textContent()) ?? '';
		// 内部コードが英語のまま露出していないことを確認
		expect(text).not.toMatch(/\bkinder\b/);
		expect(text).not.toMatch(/\bpreschool\b/);
		// 日本語ラベルが描画されている
		expect(text).toContain('幼児');
		expect(text).toContain('小学生');
	});
});

test.describe('#1171 Marketplace filter mobile', () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test('モバイルでフィルタ開くボタンが表示される', async ({ page }) => {
		await page.goto('/marketplace');
		await expect(page.locator('[data-testid="filter-open-button"]').first()).toBeVisible();
	});
});
