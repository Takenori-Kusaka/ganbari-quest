// tests/e2e/admin-settings-export-gate.spec.ts
// #773: /admin/settings のエクスポート UI プランゲートを E2E で検証する
//
// E2E のローカル認証モードは `plan-limit-service.ts#resolvePlanTier` の早期 return
// （`getAuthMode() === 'local'` → 常に 'family'）が働くため、デフォルトで family プラン
// 相当になる。よってこのスペックでは「paid UI が正しく描画される」ことを検証する。
//
// Free プランの upsell UI の仕様は `tests/unit/routes/admin-settings-export-gate.test.ts`
// でサーバ load が canExport=false / maxCloudExports=0 を返すことを検証済み。
// 本 E2E は「その値を受けた Svelte テンプレートが期待どおりに描画されるか」の保証に徹する。

import { expect, test } from '@playwright/test';

test.describe('#773 /admin/settings エクスポート UI (paid path)', () => {
	test.beforeEach(async ({ page }) => {
		test.slow(); // Vite dev コールドコンパイル
		await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
	});

	test('有料プラン相当の local モードではデータエクスポートボタンが有効', async ({ page }) => {
		// データ管理カード自体が表示されている
		const section = page.getByTestId('data-export-section');
		await expect(section).toBeVisible();

		// upsell 要素は表示されていない
		await expect(page.getByTestId('export-upsell')).toHaveCount(0);

		// ボタンは有効、有料限定ラベルではない
		const button = page.getByTestId('data-export-button');
		await expect(button).toBeVisible();
		await expect(button).toBeEnabled();
		await expect(button).not.toContainText('有料プラン限定');

		// includeFiles / compactFormat チェックボックスが描画されている
		await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();
	});

	test('local モードではクラウド共有カードは描画されない（cognito 限定 UI）', async ({ page }) => {
		// authMode=local ではクラウド共有カード自体が描画されない仕様
		await expect(page.getByTestId('cloud-export-card')).toHaveCount(0);
	});
});
