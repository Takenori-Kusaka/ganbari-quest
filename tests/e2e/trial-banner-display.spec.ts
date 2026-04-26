// tests/e2e/trial-banner-display.spec.ts
// #750: TrialBanner の表示状態 E2E テスト
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で各プランユーザーでログインし、
// TrialBanner コンポーネントの 3 状態（未開始 / アクティブ / 期限切れ）が
// 正しく表示されることを検証する。
//
// trial-flow.spec.ts がトライアルのライフサイクル（開始→アクティブ→終了の遷移）を
// 検証するのに対し、この spec は「各プラン × 各トライアル状態」のマトリクスで
// バナーの表示/非表示を網羅的に検証する。
//
// #1535: loginAsPlan() を storageState ベースに移行（describe ブロック分割）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts trial-banner-display

import { expect, test } from '@playwright/test';

// ============================================================
// free プラン — トライアル未使用 → not-started バナー
// ============================================================
test.describe('#750 TrialBanner 表示 — free（トライアル未使用）', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free ユーザーの /admin に not-started バナーが表示される', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		const banner = page.getByTestId('trial-banner-not-started');
		await expect(banner).toBeVisible({ timeout: 30_000 });
		await expect(banner).toContainText('7日間');
		await expect(page.getByTestId('trial-banner-start-button')).toBeVisible();
	});

	test('not-started バナーに「カード登録不要」のテキストがある', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		const banner = page.getByTestId('trial-banner-not-started');
		await expect(banner).toBeVisible({ timeout: 30_000 });
		await expect(banner).toContainText('カード登録不要');
	});
});

// ============================================================
// trial-expired — 期限切れ → expired バナー
// ============================================================
test.describe('#750 TrialBanner 表示 — trial-expired', () => {
	test.use({ storageState: 'playwright/.auth/trial-expired.json' });

	test('トライアル期限切れユーザーの /admin に expired バナーが表示される', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		const banner = page.getByTestId('trial-banner-expired');
		await expect(banner).toBeVisible({ timeout: 30_000 });
		await expect(banner).toContainText('終了');
	});

	test('expired バナーにアップグレード CTA が表示される', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		const cta = page.getByTestId('trial-banner-expired-cta');
		await expect(cta).toBeVisible({ timeout: 30_000 });
		await expect(cta).toContainText('アップグレード');
	});

	test('expired ユーザーには「開始」ボタンが表示されない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// expired バナーが表示されるまで待つ
		await page.getByTestId('trial-banner-expired').waitFor({ state: 'visible', timeout: 30_000 });
		await expect(page.getByTestId('trial-banner-start-button')).toHaveCount(0);
	});
});

// ============================================================
// standard / family プラン — トライアルバナー非表示
// ============================================================
test.describe('#750 TrialBanner 表示 — standard（有料プラン）', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランユーザーにはトライアルバナーが表示されない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// /admin のメインコンテンツが描画されるまで待つ
		await page.waitForLoadState('domcontentloaded');

		// TrialBanner の全 3 状態がいずれも表示されない
		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-expired')).toHaveCount(0);
		// active バナーには testid がないため、「無料体験中」テキストの不在で確認
		await expect(page.getByText('無料体験中')).toHaveCount(0);
	});
});

test.describe('#750 TrialBanner 表示 — family（有料プラン）', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランユーザーにはトライアルバナーが表示されない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		await page.waitForLoadState('domcontentloaded');

		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-expired')).toHaveCount(0);
		await expect(page.getByText('無料体験中')).toHaveCount(0);
	});
});
