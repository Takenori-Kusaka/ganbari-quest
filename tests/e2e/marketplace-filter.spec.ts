// tests/e2e/marketplace-filter.spec.ts
// #1171: マーケットプレイス フィルタ UI 刷新の E2E 検証
//
// AC 検証対象:
// - 年齢フィルタが age-tier 5 モード (baby/preschool/elementary/junior/senior) で動作する
// - 性別フィルタ (boy/girl/neutral) が URL クエリ `?gender=xxx` に反映される
// - 並び替え Select で URL クエリ `?sort=newest` 等に反映される
// - 件数表示 `[data-testid="result-count"]` が数値を含む
// - モバイル (Pixel 7) で `[data-testid="filter-open-button"]` が表示される
// - リセット CTA で全クエリが消える
// - labels.ts SSOT: 内部コード (kinder/preschool 等) が画面に露出しない

import { expect, type Page, test } from '@playwright/test';

/**
 * viewport に応じて filter 要素を表示状態にするヘルパ。
 * mobile project: bottom sheet ダイアログを開く。
 * tablet project: 何もしない（sidebar は常に可視）。
 */
async function openFilterIfMobile(page: Page, isMobile: boolean): Promise<void> {
	if (!isMobile) return;
	const openButton = page.locator('[data-testid="filter-open-button"]').first();
	await openButton.click();
	// dialog 内の filter-panel-mobile が可視になるまで待つ
	await expect(page.locator('[data-testid="filter-panel-mobile"]').first()).toBeVisible();
}

test.describe('#1171 Marketplace filter UI', () => {
	test('年齢フィルタ (preschool) で URL クエリ `?age=preschool` が付く', async ({
		page,
	}, testInfo) => {
		const isMobile = testInfo.project.name === 'mobile';
		await page.goto('/marketplace');
		await openFilterIfMobile(page, isMobile);
		// mobile は dialog 内、desktop は sidebar 内の要素。.first() で先頭をクリック。
		const selector = isMobile
			? '[data-testid="filter-panel-mobile"] [data-testid="filter-age-preschool"]'
			: '[data-testid="filter-panel-desktop"] [data-testid="filter-age-preschool"]';
		await page.locator(selector).first().click();
		await expect(page).toHaveURL(/[?&]age=preschool\b/);
	});

	test('性別フィルタ (boy) で URL クエリ `?gender=boy` が付く', async ({ page }, testInfo) => {
		const isMobile = testInfo.project.name === 'mobile';
		await page.goto('/marketplace');
		await openFilterIfMobile(page, isMobile);
		const selector = isMobile
			? '[data-testid="filter-panel-mobile"] [data-testid="filter-gender-boy"]'
			: '[data-testid="filter-panel-desktop"] [data-testid="filter-gender-boy"]';
		await page.locator(selector).first().click();
		await expect(page).toHaveURL(/[?&]gender=boy\b/);
	});

	test('件数表示が数値 + "件" を含む', async ({ page }) => {
		await page.goto('/marketplace');
		const count = await page.locator('[data-testid="result-count"]').first().textContent();
		expect(count?.trim() ?? '').toMatch(/^\d+件$/);
	});

	test('リセット CTA 押下で全クエリが消える', async ({ page }, testInfo) => {
		const isMobile = testInfo.project.name === 'mobile';
		await page.goto('/marketplace?age=elementary&gender=girl');
		await openFilterIfMobile(page, isMobile);
		const selector = isMobile
			? '[data-testid="filter-panel-mobile"] [data-testid="filter-reset"]'
			: '[data-testid="filter-panel-desktop"] [data-testid="filter-reset"]';
		await page.locator(selector).first().click();
		await expect(page).toHaveURL(/\/marketplace\/?$/);
	});

	test('年齢フィルタのラベルは内部コード (kinder/preschool 等) を露出しない', async ({
		page,
	}, testInfo) => {
		const isMobile = testInfo.project.name === 'mobile';
		await page.goto('/marketplace');
		await openFilterIfMobile(page, isMobile);
		const panelSelector = isMobile
			? '[data-testid="filter-panel-mobile"]'
			: '[data-testid="filter-panel-desktop"]';
		const panel = page.locator(panelSelector).first();
		const text = (await panel.textContent()) ?? '';
		// 内部コードが英語のまま露出していないことを確認
		expect(text).not.toMatch(/\bkinder\b/);
		expect(text).not.toMatch(/\bpreschool\b/);
		// 日本語ラベルが描画されている
		expect(text).toContain('幼児');
		expect(text).toContain('小学生');
	});

	test('モバイル project: フィルタ開くボタンが表示される', async ({ page }, testInfo) => {
		// tablet project では mobile 専用 UI がないのでスキップ
		test.skip(testInfo.project.name !== 'mobile', 'mobile project only');
		await page.goto('/marketplace');
		await expect(page.locator('[data-testid="filter-open-button"]').first()).toBeVisible();
	});
});
