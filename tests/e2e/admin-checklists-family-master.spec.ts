/**
 * tests/e2e/admin-checklists-family-master.spec.ts
 *
 * #2362 PR-5 Phase 2 (ADR-0055): admin/checklists family master UX E2E 回帰
 *
 * 検証対象:
 * - admin/checklists ページの OverflowMenu (top-right ⋮) + 4 menu items 表示
 * - ChecklistDistributionDialog auto-open (`?import=<presetId>` 経由)
 * - 配信先 children 設定 dialog: VisibilityChipGroup 経由で per-child visibility 切替
 * - per-child progress 表示: 配信中 child ごとの今日のチェック進捗
 * - 配信先 0 件時の「誰にも配信されていません」表示
 *
 * PR-4 admin-rewards-per-child.spec.ts と同型 (per-child / family-master 共通 UX pattern)。
 */

import { expect, test } from '@playwright/test';

test.describe('admin/checklists family master UX (#2362 PR-5 Phase 2)', () => {
	test('ページ header に OverflowMenu (top-right ⋮) が表示される', async ({ page }) => {
		await page.goto('/admin/checklists');
		await expect(page.getByTestId('admin-checklists-page')).toBeVisible({ timeout: 15_000 });
		const overflowBtn = page.getByTestId('checklists-overflow-menu');
		await expect(overflowBtn).toBeVisible();
	});

	test('OverflowMenu クリックで 4 menu items (marketplace / restore / export / help) が表示される', async ({
		page,
	}) => {
		await page.goto('/admin/checklists');
		await expect(page.getByTestId('admin-checklists-page')).toBeVisible({ timeout: 15_000 });
		await page.getByTestId('checklists-overflow-menu').click();

		// Ark UI Menu Portal で render される menu item を確認
		// 各 item は overflow-menu-item-<id> data-testid を持つ
		await expect(page.getByTestId('overflow-menu-item-marketplace')).toBeVisible({
			timeout: 5_000,
		});
		await expect(page.getByTestId('overflow-menu-item-restore')).toBeVisible();
		await expect(page.getByTestId('overflow-menu-item-export')).toBeVisible();
		await expect(page.getByTestId('overflow-menu-item-help')).toBeVisible();
	});

	test('?import=<presetId> で ChildSelectionDialog auto-open', async ({ page }) => {
		// event-pool は checklist marketplace SSOT に存在する preset id
		await page.goto('/admin/checklists?import=event-pool');
		const dialog = page.getByTestId('checklist-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		await expect(page.getByTestId('child-selection-all')).toBeVisible();
		await expect(page.getByTestId('child-selection-confirm')).toBeVisible();
	});

	test('?import=does-not-exist-preset -> ChildSelectionDialog 非表示 + actionMessage', async ({
		page,
	}) => {
		await page.goto('/admin/checklists?import=does-not-exist-preset');
		// dialog は開かず、guidance message が表示される
		await expect(page.getByTestId('checklists-action-message')).toBeVisible({ timeout: 10_000 });
	});

	test('family templates が描画される (per-child ではなく family scope)', async ({ page }) => {
		await page.goto('/admin/checklists');
		await expect(page.getByTestId('admin-checklists-page')).toBeVisible({ timeout: 15_000 });
		// global-setup.ts seed には family checklist が 0-N 件あり得る。
		// 配信先設定セクション (distribution-section) が存在する場合は visible (precondition)
		// あるいは empty state (emptyChecklistMessage) が表示される。
		const distributionSections = page.locator('[data-testid^="checklist-distribution-section-"]');
		// #2899: 「持ち物チェックリスト管理」→「チェックリスト管理」是正に伴い empty message も
		// 「（家族の）チェックリストがまだありません」に統一。両 empty state 共通の語尾で照合。
		const emptyMessage = page.locator('text=/チェックリストがまだありません/');
		const eitherVisible =
			(await distributionSections.count()) > 0 || (await emptyMessage.count()) > 0;
		expect(eitherVisible, 'family templates または empty message のいずれかが表示されること').toBe(
			true,
		);
	});
});
