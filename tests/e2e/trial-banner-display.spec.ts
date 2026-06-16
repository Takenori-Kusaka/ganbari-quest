// tests/e2e/trial-banner-display.spec.ts
// トライアル表示の状態マトリクス E2E（#750 → #3033 で再設計）
//
// #3033 (PO 指摘 2026-06-12): 全ページ常設の trial バナー (not-started / expired) は
// モバイルで画面の半分を占め、無料版のまま使い続けるユーザーの不利益になるため撤去。
// - 残日数 = header pill (`header-trial-pill`、trial active 中のみ)
// - 開始導線 = /admin/subscription の開始セクション (`subscription-start-trial-button`)
// - 期限切れ通知 = 一回限りの TrialEndedDialog (#770)
// - body バナー = urgent (残 1 日以下) のみ (`trial-banner-urgent`)
//
// trial-flow.spec.ts がライフサイクル（開始→active→終了の遷移）を検証するのに対し、
// この spec は「各プラン × 各トライアル状態」のマトリクスで表示/非表示を網羅検証する。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts trial-banner-display

import { expect, test } from '@playwright/test';

// ============================================================
// free プラン — トライアル未使用: 常設バナーなし + 開始導線は subscription
// ============================================================
test.describe('トライアル表示 — free（未使用、#3033）', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free ユーザーの /admin に常設トライアルバナーが出ない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// header の常設導線 (アップグレード) は出る
		await expect(page.locator('[data-tutorial="upgrade-btn"]')).toBeVisible({ timeout: 30_000 });
		// 常設バナーは出ない (#3033)
		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-urgent')).toHaveCount(0);
		// trial 非 active なので pill も出ない
		await expect(page.getByTestId('header-trial-pill')).toHaveCount(0);
	});

	test('開始導線は /admin/subscription の開始セクションに出る', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const startBtn = page.getByTestId('subscription-start-trial-button');
		await expect(startBtn).toBeVisible({ timeout: 30_000 });
	});
});

// ============================================================
// trial-expired — 常設バナーなし + 再開始不可
// ============================================================
test.describe('トライアル表示 — trial-expired（#3033）', () => {
	test.use({ storageState: 'playwright/.auth/trial-expired.json' });

	test('期限切れユーザーの /admin に常設バナーが出ない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		await expect(page.locator('[data-tutorial="upgrade-btn"]')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('trial-banner-expired')).toHaveCount(0);
		await expect(page.getByTestId('header-trial-pill')).toHaveCount(0);
	});

	test('期限切れユーザーには開始導線が出ない（1 回限りルール）', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		await expect(page.getByTestId('saas-license-panel')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('subscription-start-trial-button')).toHaveCount(0);
	});
});

// ============================================================
// standard / family プラン — トライアル UI 一切非表示
// ============================================================
test.describe('トライアル表示 — standard（有料プラン）', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランユーザーにはトライアル UI が表示されない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		await page.waitForLoadState('domcontentloaded');

		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-expired')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-urgent')).toHaveCount(0);
		await expect(page.getByTestId('header-trial-pill')).toHaveCount(0);
	});
});

test.describe('トライアル表示 — family（有料プラン）', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランユーザーにはトライアル UI が表示されない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		await page.waitForLoadState('domcontentloaded');

		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-expired')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-urgent')).toHaveCount(0);
		await expect(page.getByTestId('header-trial-pill')).toHaveCount(0);
	});
});
