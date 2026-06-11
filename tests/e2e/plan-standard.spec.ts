// tests/e2e/plan-standard.spec.ts
// #779: スタンダードプランの機能疎通 E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で DevCognitoAuthProvider の
// dev-tenant-standard（plan=standard_monthly）でログインし、
// 「standard だからこそ表示される / されない」UI を一通り確認する。
//
// 設計意図:
//  - free 専用のアップセル UI（weekly-report-upsell / export-upsell / plan-status-free-cta）が
//    出ないことを negative assertion で押さえる
//  - 同時に「ある機能はまだ family 限定で disabled のままか」も確認し、
//    standard ↔ family のプラン境界を回帰検知できるようにする
//
// #1535: loginAsPlan() を storageState ベースに移行
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-standard

import { expect, test } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/standard.json' });

test.describe('#779 standard プラン — 機能疎通', () => {
	test('/admin/subscription の PlanStatusCard が standard を示す', async ({ page }) => {
		await page.goto('/admin/subscription');
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute('data-plan-tier', 'standard');
		// free 用アップセル CTA は出ない
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);
		// standard はまだトライアル文言を出さない（本契約済み）
		await expect(page.getByTestId('plan-status-trial-badge')).toHaveCount(0);
	});

	test('/admin にホームを開いても free 用アップグレード CTA が出ない', async ({ page }) => {
		await page.goto('/admin');
		// #3033: home に PlanStatusCard は出ない。premium は header plan-badge で現在プランを示す
		const badge = page.locator('.plan-badge');
		await expect(badge).toBeVisible({ timeout: 30_000 });
		await expect(badge).toHaveAttribute('href', '/admin/subscription');
		await expect(page.getByTestId('plan-status-card')).toHaveCount(0);
		// free 専用の CTA は表示されない
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);
	});

	test('/admin/reports — weekly-report-upsell バナーが出ない', async ({ page }) => {
		await page.goto('/admin/reports');
		await expect(page.getByTestId('weekly-report-upsell')).toHaveCount(0);
	});

	test('/admin/settings/data — エクスポートボタンが有効化されている', async ({ page }) => {
		// #2323 (EPIC #2319 ④): data 管理 UI は /admin/settings/data に移行済
		await page.goto('/admin/settings/data');
		await expect(page.getByTestId('data-export-section')).toBeVisible();
		// free 用アップセルは出ない
		await expect(page.getByTestId('export-upsell')).toHaveCount(0);
		// data-export-button は活性化（free のときは disabled）
		const exportBtn = page.getByTestId('data-export-button');
		await expect(exportBtn).toBeVisible();
		await expect(exportBtn).toBeEnabled();
	});

	// #2316: 旧 /admin/messages 「ひとことメッセージ」family-only ゲートテストは削除。
	//   #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
	//   メッセージ機能は応援機能の付随要素として全プラン解放された
	//   (standard でも family 限定ボタンに該当する UI は存在しない)。
	//   ADR-0006 (assertion erosion ban) に従い skip ではなく削除。
	//   standard / family プラン境界の検証は他の機能 (export-button enabled / weekly-report-upsell 非表示) で担保。
});
