// tests/e2e/admin-checklists-no-kind-tab.spec.ts
// #1756 (#1709-B): /admin/checklists kind タブ削除（持ち物純化）の E2E
//
// 検証対象:
// 1. /admin/checklists にアクセスできる
// 2. routine / item の 2 タブ UI が DOM に存在しない（role=tablist で「チェックリスト種別」aria-label のものが無い）
// 3. 「ルーティン」表示が画面に出ない
// 4. チェックリスト作成手段（#2903 で「+ 追加」dropdown menu に集約）が必ず提示される

import { expect, test } from '@playwright/test';

test.describe('#1756 (#1709-B) admin/checklists kind タブ削除', () => {
	test('/admin/checklists を開ける', async ({ page }) => {
		const res = await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);
	});

	test('「チェックリスト種別」role=tablist が存在しない', async ({ page }) => {
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		// 旧 kind タブは role="tablist" + aria-label="チェックリスト種別"
		const kindTablist = page.getByRole('tablist', { name: 'チェックリスト種別' });
		await expect(kindTablist).toHaveCount(0);
	});

	test('「ルーティン」「routine」表示が画面に出ない', async ({ page }) => {
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		// ページ全体テキストに「ルーティン」が含まれない
		const body = page.locator('body');
		await expect(body).not.toContainText('ルーティン');
		await expect(body).not.toContainText('routine');
	});

	test('チェックリスト作成手段（「+ 追加」dropdown menu）が表示される', async ({ page }) => {
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		// #1756 の意図: kind タブ削除後も「チェックリストを作成する手段」が必ず提示される
		//（テストデータに依存しない strict な確認）。
		// #2903 の add UI 再構成で旧「持ち物作成ボタン」(直置きボタン) は「+ 追加」dropdown menu
		// (testid=checklists-add-menu、label は ADMIN_CHECKLISTS_PAGE_LABELS.addMenuButton) に集約された。
		// 作成手段（add menu trigger）が visible であることを web-first assertion で確認する
		//（#1768: isVisible() の同期評価による flake を避け、auto-retry に委ねる）。
		await expect(page.getByTestId('checklists-add-menu')).toBeVisible({ timeout: 15_000 });
	});
});
