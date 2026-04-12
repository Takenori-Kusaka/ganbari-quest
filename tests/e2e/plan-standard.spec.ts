// tests/e2e/plan-standard.spec.ts
// #779: スタンダードプランの機能疎通 E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で DevCognitoAuthProvider の
// dev-tenant-standard（plan=standard_monthly）でログインし、
// 「standard だからこそ表示される / されない」UI を一通り確認する。
//
// 設計意図:
//  - free 専用のアップセル UI（weekly-report-upsell / export-upsell / plan-quick-link--free）が
//    出ないことを negative assertion で押さえる
//  - 同時に「ある機能はまだ family 限定で disabled のままか」も確認し、
//    standard ↔ family のプラン境界を回帰検知できるようにする
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-standard

import { expect, test } from '@playwright/test';
import { loginAsPlan, warmupAdminPages } from './plan-login-helpers';

test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupAdminPages(browser, [
		'/admin',
		'/admin/license',
		'/admin/reports',
		'/admin/settings',
		'/admin/messages',
	]);
});

test.describe('#779 standard プラン — 機能疎通', () => {
	test.beforeEach(() => {
		test.slow(); // Vite dev のコールドコンパイルでタイムアウトを 3x 延長
	});

	test('/admin/license の PlanStatusCard が standard を示す', async ({ page }) => {
		await loginAsPlan(page, 'standard');
		await page.goto('/admin/license');
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute('data-plan-tier', 'standard');
		// free 用アップセル CTA は出ない
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);
		// standard はまだトライアル文言を出さない（本契約済み）
		await expect(page.getByTestId('plan-status-trial-badge')).toHaveCount(0);
	});

	test('/admin にホームを開いても free 用 quick-link が出ない', async ({ page }) => {
		await loginAsPlan(page, 'standard');
		await page.goto('/admin');
		// free のときだけ表示される「無料プラン もっと便利に使いませんか？」リンク
		await expect(page.locator('.plan-quick-link--free')).toHaveCount(0);
	});

	test('/admin/reports — weekly-report-upsell バナーが出ない', async ({ page }) => {
		await loginAsPlan(page, 'standard');
		await page.goto('/admin/reports');
		await expect(page.getByTestId('weekly-report-upsell')).toHaveCount(0);
	});

	test('/admin/settings — エクスポートボタンが有効化されている', async ({ page }) => {
		await loginAsPlan(page, 'standard');
		await page.goto('/admin/settings');
		await expect(page.getByTestId('data-export-section')).toBeVisible();
		// free 用アップセルは出ない
		await expect(page.getByTestId('export-upsell')).toHaveCount(0);
		// data-export-button は活性化（free のときは disabled）
		const exportBtn = page.getByTestId('data-export-button');
		await expect(exportBtn).toBeVisible();
		await expect(exportBtn).toBeEnabled();
	});

	test('/admin/messages — ひとことメッセージは family 限定で disabled のまま', async ({ page }) => {
		// プラン境界の回帰検知: standard はまだ family 限定機能にアクセスできない
		await loginAsPlan(page, 'standard');
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeDisabled();
	});
});
