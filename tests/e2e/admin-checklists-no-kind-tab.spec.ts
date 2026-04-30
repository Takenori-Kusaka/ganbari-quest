// tests/e2e/admin-checklists-no-kind-tab.spec.ts
// #1756 (#1709-B): /admin/checklists kind タブ削除（持ち物純化）の E2E
//
// 検証対象:
// 1. /admin/checklists にアクセスできる
// 2. routine / item の 2 タブ UI が DOM に存在しない（role=tablist で「チェックリスト種別」aria-label のものが無い）
// 3. 「ルーティン」表示が画面に出ない
// 4. 持ち物リスト（または empty state）のみが表示される

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

	test('持ち物作成ボタン / empty state のいずれかが表示される', async ({ page }) => {
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		// 「持ち物チェックリスト」「持ち物」「テンプレート」のいずれかの文言が表示される
		// （テストデータに依存しない strict な確認）
		const hasItemContext = await page
			.getByText(/持ち物|テンプレート/)
			.first()
			.isVisible();
		expect(hasItemContext).toBe(true);
	});
});
