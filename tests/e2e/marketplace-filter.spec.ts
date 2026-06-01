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

	// Round 18 Cluster I (#11/#15/#19): 50+ tag が並列表示されて Hick's Law 違反していた認知負荷を、
	// default 人気 8 件 + expansion で削減した変更の回帰防止
	test('タグは default 8 件のみ表示され、「もっと見る」で展開可能 (Cluster I)', async ({
		page,
	}, testInfo) => {
		const isMobile = testInfo.project.name === 'mobile';
		const variant = isMobile ? 'mobile' : 'desktop';
		await page.goto('/marketplace');
		await openFilterIfMobile(page, isMobile);

		const panelSelector = `[data-testid="filter-panel-${variant}"]`;
		const panel = page.locator(panelSelector).first();
		const toggle = panel.locator(`[data-testid="filter-tag-toggle-${variant}"]`);

		// expansion link 表示中 (= total > 8 件 = seed では 50+) の状態を確認
		await expect(toggle).toBeVisible();
		const initialLabel = (await toggle.textContent()) ?? '';
		expect(initialLabel).toContain('もっと見る');

		// default は 8 件以下 (chip = filter-tag-* testid count)
		const chipCount = await panel
			.locator(
				'[data-testid^="filter-tag-"]:not([data-testid$="-toggle-desktop"]):not([data-testid$="-toggle-mobile"])',
			)
			.count();
		expect(chipCount).toBeLessThanOrEqual(8);

		// click で expansion (aria-expanded true + label が「たたむ」へ)
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		const expandedLabel = (await toggle.textContent()) ?? '';
		expect(expandedLabel).toContain('たたむ');

		// expansion 後は全 tag が見える (8 件超)
		const expandedCount = await panel
			.locator(
				'[data-testid^="filter-tag-"]:not([data-testid$="-toggle-desktop"]):not([data-testid$="-toggle-mobile"])',
			)
			.count();
		expect(expandedCount).toBeGreaterThan(8);

		// collapse 動線も確認
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	});
});
