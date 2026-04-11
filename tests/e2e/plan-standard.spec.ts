// tests/e2e/plan-standard.spec.ts
// #779: standard プランで各機能が想定通り enable されていることの疎通 E2E。
//
// cognito-dev モード（AUTH_MODE=cognito + COGNITO_DEV_MODE=true）で standard@example.com
// としてログインし、無料プランゲートが外れていることを UI 状態から検証する。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-standard

import { expect, test } from '@playwright/test';
import { loginAs, warmupCognitoDev } from './cognito-dev-helpers';

test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupCognitoDev(browser, ['/admin', '/admin/license', '/admin/settings']);
});

test.describe('#779 standard プランの機能疎通', () => {
	test.beforeEach(() => {
		test.slow(); // Vite dev cold compile 対策
	});

	test('/admin ダッシュボードで free 向けアップグレードリンクが表示されない', async ({ page }) => {
		await loginAs(page, 'standard');
		await page.goto('/admin');
		// free プランだけに表示される `.plan-quick-link--free` が存在しないことを確認
		await expect(page.locator('.plan-quick-link--free')).toHaveCount(0);
	});

	test('/admin/license の PlanStatusCard が "スタンダード プラン" を示す', async ({ page }) => {
		await loginAs(page, 'standard');
		await page.goto('/admin/license');
		const card = page.locator('.plan-status-card--standard');
		await expect(card).toBeVisible();
		await expect(card).toContainText('スタンダード プラン');
		// free 向けバッジ/CTA は出ていないはず
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);
	});

	test('/admin/settings のデータエクスポートが有効化されている', async ({ page }) => {
		await loginAs(page, 'standard');
		await page.goto('/admin/settings');
		// データエクスポートセクションまでスクロール
		const section = page.getByTestId('data-export-section');
		await section.scrollIntoViewIfNeeded();
		await expect(section).toBeVisible();
		// free プラン向けアップセルは DOM に存在しない
		await expect(page.getByTestId('export-upsell')).toHaveCount(0);
		// エクスポートボタンは enabled
		const exportBtn = page.getByTestId('data-export-button');
		await expect(exportBtn).toBeVisible();
		await expect(exportBtn).toBeEnabled();
	});
});
