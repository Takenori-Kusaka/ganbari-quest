// tests/e2e/plan-family.spec.ts
// #779: ファミリープランの機能疎通 E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で DevCognitoAuthProvider の
// dev-tenant-family（plan=family_monthly）でログインし、
// 「family だからこそ全機能が解放されている」状態を一通り確認する。
//
// 設計意図:
//  - free / standard で出ていたアップセル UI が一切出ないこと
//  - family 限定機能（ひとことメッセージ等）が enabled で操作可能なこと
//  - PlanStatusCard が family を示すこと
//
// #1535: loginAsPlan() を storageState ベースに移行
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-family

import { expect, test } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/family.json' });

test.describe('#779 family プラン — 全機能解放確認', () => {
	test('/admin/license の PlanStatusCard が family を示す', async ({ page }) => {
		await page.goto('/admin/license');
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute('data-plan-tier', 'family');
		// free 用アップセル CTA は出ない
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);
		// 本契約済みなのでトライアルバッジは出ない
		await expect(page.getByTestId('plan-status-trial-badge')).toHaveCount(0);
	});

	test('/admin にホームを開いても free 用アップグレード CTA が出ない', async ({ page }) => {
		await page.goto('/admin');
		// family のときは PlanStatusCard が data-plan-tier="family" で表示される
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'family');
		// free 専用の CTA は表示されない
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);
	});

	test('/admin/reports — weekly-report-upsell バナーが出ない', async ({ page }) => {
		await page.goto('/admin/reports');
		await expect(page.getByTestId('weekly-report-upsell')).toHaveCount(0);
	});

	test('/admin/settings — エクスポートボタンが有効化されている', async ({ page }) => {
		await page.goto('/admin/settings');
		await expect(page.getByTestId('data-export-section')).toBeVisible();
		await expect(page.getByTestId('export-upsell')).toHaveCount(0);
		const exportBtn = page.getByTestId('data-export-button');
		await expect(exportBtn).toBeVisible();
		await expect(exportBtn).toBeEnabled();
	});

	test('/admin/messages — ひとことメッセージは family 限定機能として有効', async ({ page }) => {
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeEnabled();
	});
});
