// tests/e2e/plan-family.spec.ts
// #779: family プランで standard の全機能に加え、family 限定機能が enable されている
// ことの疎通 E2E。
//
// cognito-dev モード（AUTH_MODE=cognito + COGNITO_DEV_MODE=true）で family@example.com
// としてログインし、プランゲートが外れていることを UI 状態から検証する。
//
// family 限定機能で UI で判定できるもの:
//  - /admin/messages のひとことメッセージ（自由テキスト）ボタンが enabled
//    （#776 の plan-gated-features.spec.ts でも検証済みだが、family プラン疎通として
//     独立に保持する）
//  - /admin/license の PlanStatusCard が "ファミリー プラン"
//
// 月次比較レポート / きょうだいランキング / 無制限履歴保持 は子データ前提の機能のため
// この spec では扱わない（専用のデータ投入 E2E を別途用意する想定）。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-family

import { expect, test } from '@playwright/test';
import { loginAs, warmupCognitoDev } from './cognito-dev-helpers';

test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupCognitoDev(browser, [
		'/admin',
		'/admin/license',
		'/admin/settings',
		'/admin/messages',
	]);
});

test.describe('#779 family プランの機能疎通', () => {
	test.beforeEach(() => {
		test.slow();
	});

	test('/admin ダッシュボードで free 向けアップグレードリンクが表示されない', async ({ page }) => {
		await loginAs(page, 'family');
		await page.goto('/admin');
		await expect(page.locator('.plan-quick-link--free')).toHaveCount(0);
	});

	test('/admin/license の PlanStatusCard が "ファミリー プラン" を示す', async ({ page }) => {
		await loginAs(page, 'family');
		await page.goto('/admin/license');
		const card = page.locator('.plan-status-card--family');
		await expect(card).toBeVisible();
		await expect(card).toContainText('ファミリー プラン');
		// free 向けバッジ/CTA は出ていないはず
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);
	});

	test('/admin/settings のデータエクスポートが有効化されている', async ({ page }) => {
		await loginAs(page, 'family');
		await page.goto('/admin/settings');
		const section = page.getByTestId('data-export-section');
		await section.scrollIntoViewIfNeeded();
		await expect(section).toBeVisible();
		await expect(page.getByTestId('export-upsell')).toHaveCount(0);
		const exportBtn = page.getByTestId('data-export-button');
		await expect(exportBtn).toBeVisible();
		await expect(exportBtn).toBeEnabled();
	});

	test('/admin/messages のひとことメッセージ（family 限定）が enabled', async ({ page }) => {
		await loginAs(page, 'family');
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeEnabled();
	});
});
