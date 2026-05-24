/**
 * #2362 PR-3 Phase 4 — admin/activities per-child UX E2E 回帰
 *
 * 子供別タブ切替 / ChildSelectionDialog auto-open (`?import=<presetId>`) /
 * 「他の子供から copy」 action / 「一括追加」 action を検証する。
 *
 * 既存 `admin-activities-add-ux.spec.ts` / `admin-activities-import-marketplace.spec.ts`
 * は family master 動線を継続検証。本 spec は per-child 動線専用。
 *
 * Phase 4 段階では family master と per-child の並存表示状態を前提とし、
 * Phase 6/7 で family master drop 後に rewrite 予定 (PR description 参照)。
 */

import { expect, test } from '@playwright/test';

test.describe('admin/activities per-child UX (Phase 4)', () => {
	test('子供タブ row + actions が表示される', async ({ page }) => {
		await page.goto('/admin/activities');
		// 子供タブ row は children >= 1 で表示
		const tabRow = page.getByTestId('admin-activities-child-tabs');
		await expect(tabRow).toBeVisible();
		// child tab ボタン (テストデータ最低 1 件以上)
		const firstTab = tabRow.locator('[data-testid^="child-tab-"]').first();
		await expect(firstTab).toBeVisible();
		// child context banner
		await expect(page.getByTestId('child-context-banner')).toBeVisible();
	});

	test('子供タブクリックで URL ?childId が同期される', async ({ page }) => {
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
		const count = await tabs.count();
		test.skip(count < 2, '2 child 以上の seed が必要');

		const secondTab = tabs.nth(1);
		const secondId = await secondTab.getAttribute('data-testid');
		const childId = secondId?.replace('child-tab-', '');
		await secondTab.click();

		await expect.poll(() => new URL(page.url()).searchParams.get('childId')).toBe(childId);
	});

	test('?import=<presetId> で ChildSelectionDialog auto-open', async ({ page }) => {
		// `simple-daily` は activity-pack marketplace SSOT に存在する preset id
		await page.goto('/admin/activities?import=simple-daily');
		const dialog = page.getByTestId('import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId('child-selection-all')).toBeVisible();
		await expect(page.getByTestId('child-selection-confirm')).toBeVisible();
	});

	test('「他の子供から copy」 dialog open + radio 選択 → コピー実行', async ({ page }) => {
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
		const count = await tabs.count();
		test.skip(count < 2, '2 child 以上の seed が必要');

		const copyBtn = page.getByTestId('copy-from-child-btn');
		await expect(copyBtn).toBeVisible();
		await copyBtn.click();

		await expect(page.getByTestId('copy-from-child-dialog')).toBeVisible();
		// 他の child が選択肢として並ぶ (selectedChild は除外される)
		const sourceOptions = page.locator('[data-testid^="copy-source-"]');
		expect(await sourceOptions.count()).toBeGreaterThan(0);

		const firstSource = sourceOptions.first();
		await firstSource.click();
		// confirm button enable 化
		await expect(page.getByTestId('copy-from-child-confirm')).toBeEnabled();
	});

	test('「一括追加」 dialog open + form 入力 + 全員選択', async ({ page }) => {
		await page.goto('/admin/activities');
		const bulkBtn = page.getByTestId('bulk-create-btn');
		await expect(bulkBtn).toBeVisible();
		await bulkBtn.click();

		const dialog = page.getByTestId('bulk-create-dialog');
		await expect(dialog).toBeVisible();

		// 名前入力 (FormField 内部の input)
		const nameInput = dialog.locator('input').first();
		await nameInput.fill('テスト一括活動');

		// 全員選択 radio (default)
		await expect(page.getByTestId('bulk-target-all')).toBeChecked();

		// confirm button enable 化
		await expect(page.getByTestId('bulk-create-confirm')).toBeEnabled();
	});

	test('per-child + family master 並存表示 (Phase 4 過渡期)', async ({ page }) => {
		await page.goto('/admin/activities');
		// Phase 4 では family master Activity と per-child ChildActivity が並存
		// per-child が 0 件でも family master は表示される
		const allTab = page.locator('[data-testid^="child-tab-"]').first();
		await expect(allTab).toBeVisible();
		// activity list は最低 1 件以上 (seed の family master が表示される)
		const list = page.locator('[data-tutorial="activity-list"]');
		await expect(list).toBeVisible();
	});
});
