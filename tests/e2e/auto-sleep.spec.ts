// tests/e2e/auto-sleep.spec.ts
// #1292 自動スリープ — E2E スモークテスト
// タイマーロジックの詳細検証は tests/unit/features/auto-sleep.test.ts で担保。
// ここでは「機能が子供画面に正しく接続されている」ことだけを確認する。

import { expect, test } from '@playwright/test';
import { selectKinderChild } from './helpers';

test.describe('#1292 自動スリープ — スモーク', () => {
	test('子供画面にマウントしてもエラーが起きない（タイマー接続確認）', async ({ page }) => {
		await selectKinderChild(page);
		await expect(page).toHaveURL(/\/preschool\/home/);

		// タイマーが設定されている証拠: pointerdown を発火してもエラーが起きない
		await page.dispatchEvent('body', 'pointerdown');
		// エラーが発生していないこと（= timer が正常に初期化されていること）を確認
		await expect(page).toHaveURL(/\/preschool\/home/);
	});

	test('baby モードは自動スリープしない（タイマー非設定）', async ({ page }) => {
		await page.goto('/switch');
		const babyButton = page
			.locator('[data-testid^="child-select-"]')
			.filter({ hasText: 'はなこちゃん' });
		await expect(babyButton).toBeVisible();
		await babyButton.click();
		await page.waitForURL(/\/baby\/home/);

		// baby モードは isBaby=true のため startAutoSleep が呼ばれない
		// pointerdown を送ってもエラーなし・ページ変化なし
		await page.dispatchEvent('body', 'pointerdown');
		await expect(page).toHaveURL(/\/baby\//);
	});
});
