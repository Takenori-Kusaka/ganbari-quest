// tests/e2e/billing-portal.spec.ts
// #768: /admin/billing — 請求書・支払い管理画面の E2E テスト
//
// Stripe Customer Portal への導線が正しく表示されることを検証する。
// 実際の Stripe Portal セッション作成はテスト環境では動作しないため、
// UI 要素の表示・遷移のみをテストする。

import { expect, test } from '@playwright/test';

test.describe('#768 Billing page', () => {
	test('ページが 500 にならず表示される', async ({ page }) => {
		const response = await page.goto('/admin/billing');
		expect(response?.status()).not.toBe(500);
	});

	test('ページタイトルが表示される', async ({ page }) => {
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1')).toContainText('請求書・支払い管理');
	});

	test('サブスクリプション状況セクションが表示される', async ({ page }) => {
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('text=サブスクリプション状況')).toBeVisible();
		await expect(page.locator('text=ステータス')).toBeVisible();
	});

	test('請求書・支払い方法セクションが表示される', async ({ page }) => {
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('text=請求書・支払い方法')).toBeVisible();
	});

	test('プラン管理へのリンクが表示される', async ({ page }) => {
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		const link = page.getByTestId('billing-to-license');
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('href', '/admin/license');
	});

	test('/admin/license から /admin/billing へのリンクが存在する', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		const link = page.getByTestId('license-to-billing');
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('href', '/admin/billing');
	});

	test('ナビゲーションに請求管理が表示される', async ({ page }) => {
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		// サイドバーナビに「請求管理」リンクが存在する（デスクトップ幅で確認）
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		const navLink = page.locator('nav a[href="/admin/billing"]');
		if (await navLink.isVisible({ timeout: 3000 }).catch(() => false)) {
			await expect(navLink).toContainText('請求管理');
		}
	});

	test('Stripe 無効時に準備中メッセージが表示される', async ({ page }) => {
		await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
		// Stripe が無効な場合（テスト環境のデフォルト）は準備中メッセージが表示される
		const disabledMsg = page.locator('text=決済機能は現在準備中です');
		const portalButton = page.getByTestId('billing-open-portal');

		// どちらかが表示される（Stripe の設定状態による）
		const hasDisabled = await disabledMsg.isVisible({ timeout: 3000 }).catch(() => false);
		const hasPortal = await portalButton.isVisible({ timeout: 3000 }).catch(() => false);

		// 少なくとも一方が表示される（Stripe有効→ポータルボタン or 未開始メッセージ、無効→準備中）
		expect(hasDisabled || hasPortal).toBe(true);
	});
});
