/**
 * EPIC #2253 admin/activities add UX 構造的整理 — E2E 回帰テスト
 *
 * 子 ② (#2255): header + dropdown menu (manual / ai / import)
 * 子 ③ (#2256): empty state secondary import link (bulk import bridge)
 * 子 ④ (#2257): ︙ overflow menu (introduce / export / clear-all)
 */

import { expect, test } from '@playwright/test';

test.describe('EPIC #2253 — admin/activities add UX', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');
	});

	// --- 子 ② / 子 ⑤: AddActivityFab が撤去され FeedbackFab のみが残る ---
	test('AddActivityFab が撤去され、画面 FAB は FeedbackFab のみ (M3 単一 FAB / DESIGN §10)', async ({
		page,
	}) => {
		// 旧 add-activity-fab は撤去済
		await expect(page.getByTestId('add-activity-fab')).toHaveCount(0);
		// header の + 追加 ボタンが代替経路
		const addBtn = page.getByTestId('header-add-activity-btn');
		await expect(addBtn).toBeVisible();
	});

	// --- 子 ②: header + dropdown menu の 3 経路 ---
	test('header + ボタンで manual / ai / import 3 menu item が出現', async ({ page }) => {
		const addBtn = page.getByTestId('header-add-activity-btn');
		await addBtn.click();
		await expect(page.getByTestId('menu-item-manual')).toBeVisible();
		await expect(page.getByTestId('menu-item-ai')).toBeVisible();
		await expect(page.getByTestId('menu-item-import')).toBeVisible();
	});

	test('menu-item-manual click で manual Dialog が直接起動 (mode selector 中間 step なし)', async ({
		page,
	}) => {
		await page.getByTestId('header-add-activity-btn').click();
		await page.getByTestId('menu-item-manual').click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		// AddActivityModeSelector の card UI は撤去済 (撤去確認)
		await expect(page.locator('.add-mode-grid')).toHaveCount(0);
	});

	test('menu-item-import click で import panel が直接起動', async ({ page }) => {
		await page.getByTestId('header-add-activity-btn').click();
		await page.getByTestId('menu-item-import').click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
	});

	// --- 子 ④: ︙ overflow menu ---
	test('header ︙ ボタンで introduce / export / clear-all overflow menu が出現', async ({
		page,
	}) => {
		const overflowBtn = page.getByTestId('header-overflow-menu-btn');
		await overflowBtn.click();
		await expect(page.getByTestId('menu-item-introduce')).toBeVisible();
		await expect(page.getByTestId('menu-item-export')).toBeVisible();
		await expect(page.getByTestId('menu-item-clear-all')).toBeVisible();
	});

	test('menu-item-introduce click で /admin/activities/introduce へ遷移', async ({ page }) => {
		await page.getByTestId('header-overflow-menu-btn').click();
		await page.getByTestId('menu-item-introduce').click();
		await page.waitForURL(/\/admin\/activities\/introduce$/);
	});
});
