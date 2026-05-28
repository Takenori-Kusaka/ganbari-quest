/**
 * admin/activities 追加 UX E2E — Issue #2370 → #2558 段階2 で「marketplace 一本化」に再構成
 *
 * #2558 段階2 (PO 方針): admin/activities 内のマーケットプレイス風ブラウズ UI (旧 UnifiedImportHub
 * activity-pack 埋め込み) を撤去し、「みんなのテンプレートから探す」は /marketplace へ画面遷移する
 * 経路に一本化した (二重管理の解消)。本 spec は admin/activities 側の add UX を検証する:
 *   - 「みんなのテンプレートから探す」→ /marketplace (activity-pack) 遷移 (admin 内ブラウズ UI を出さない)
 *   - 「バックアップから復元」ダイアログ (マーケットプレイスとは別概念の file 復元) の起動 + cancel
 *
 * marketplace 取込の goal 完遂 (追加 → 一覧反映) は正規経路:
 *   marketplace 詳細 → /admin/activities?import=<presetId> → ChildSelectionDialog → importPackToChildren
 * を `tests/e2e/admin-activities-per-child.spec.ts` (#2558 goal 完遂テスト) で担保する。
 *
 * UnifiedImportHub component (checklist / rule-preset / challenge-set / reward で継続使用) の
 * dead-end (追加無反応 / cancel 不能) goal 完遂検証は以下で担保:
 *   - tests/e2e/marketplace-checklist-import.spec.ts (in-page browse UI の act → outcome)
 *   - tests/e2e/demo-lambda/bug1-import-dead-end.spec.ts (demo no-op response 形式)
 *   - tests/unit/marketplace/ui/UnifiedImportHub.test.ts + UnifiedImportHub.stories.svelte (play)
 */

import { expect, test } from '@playwright/test';
import { openMenu } from './helpers/goal-flows';

test.describe('admin/activities add UX — #2558 段階2 (marketplace 一本化)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('header-add-activity-btn')).toBeVisible({ timeout: 15000 });
	});

	test('「みんなのテンプレートから探す」は /marketplace (activity-pack) へ画面遷移する (admin 内ブラウズ UI を出さない)', async ({
		page,
	}) => {
		await openMenu(page, 'header-add-activity-btn', 'menu-item-browse');
		await Promise.all([
			page.waitForURL(/\/marketplace(\?|$)/, { timeout: 15_000 }),
			page.getByTestId('menu-item-browse').click(),
		]);
		// activity-pack に絞った marketplace 一覧 (正規経路の入口)
		expect(new URL(page.url()).searchParams.get('type')).toBe('activity-pack');
		// 二重管理だった admin 内ブラウズ UI (activity-import-panel / add dialog) は一切出ない
		await expect(page.getByTestId('activity-import-panel')).toHaveCount(0);
		await expect(page.getByTestId('add-activity-dialog')).toHaveCount(0);
	});

	test('「バックアップから復元」ダイアログ (file 復元、marketplace とは別概念) が起動する', async ({
		page,
	}) => {
		await openMenu(page, 'header-overflow-menu-btn', 'menu-item-restore');
		await page.getByTestId('menu-item-restore').click();
		const dialog = page.getByTestId('restore-activities-dialog');
		await expect(dialog).toBeVisible();
		// file 入力 + 読み込みボタンが存在 (旧 UnifiedImportHub file セクション相当)
		await expect(page.getByTestId('restore-file-input')).toBeVisible();
		await expect(page.getByTestId('restore-submit')).toBeVisible();
	});

	test('「バックアップから復元」ダイアログは ESC で必ず閉じられる (cancel 不能なら fail)', async ({
		page,
	}) => {
		await openMenu(page, 'header-overflow-menu-btn', 'menu-item-restore');
		await page.getByTestId('menu-item-restore').click();
		const dialog = page.getByTestId('restore-activities-dialog');
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		// Ark Dialog は閉じても DOM に残り hidden 化する → toBeHidden() で検証 (cancel 不能なら fail)
		await expect(dialog).toBeHidden({ timeout: 30_000 });
	});
});
