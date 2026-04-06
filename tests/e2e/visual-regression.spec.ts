// tests/e2e/visual-regression.spec.ts
// Visual Regression Tests -- スクリーンショット比較によるUI変更検知
//
// 初回実行: npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
// 以降の実行: npx playwright test tests/e2e/visual-regression.spec.ts
//
// ベースラインスナップショットは tests/e2e/visual-regression.spec.ts-snapshots/ に保存され、
// git にコミットしてチーム全体で共有する。

import { expect, test } from '@playwright/test';
import { selectKinderChildAndDismiss } from './helpers';

// maxDiffPixelRatio: フォントレンダリングやアンチエイリアスの微小な差異を許容
const SCREENSHOT_OPTIONS = {
	maxDiffPixelRatio: 0.01,
	animations: 'disabled' as const,
};

// 動的コンテンツを含むページ（ホーム画面、履歴画面）は他テストの活動記録で
// 表示内容が変わるため、閾値を緩めてレイアウト崩壊のみ検出する
const DYNAMIC_SCREENSHOT_OPTIONS = {
	maxDiffPixelRatio: 0.05,
	animations: 'disabled' as const,
};

// ============================================================
// Public Pages
// ============================================================
test.describe('Visual Regression: Public', () => {
	test('子供切り替え画面', async ({ page }) => {
		await page.goto('/switch');
		await expect(page.locator('h1')).toContainText('だれがつかう？');
		// 子供カードが描画されるまで待機
		await expect(page.locator('[data-testid^="child-select-"]').first()).toBeVisible();
		await expect(page).toHaveScreenshot('switch.png', SCREENSHOT_OPTIONS);
	});
});

// ============================================================
// Kinder Child Pages
// ============================================================
test.describe('Visual Regression: Kinder', () => {
	test.beforeEach(async ({ page }) => {
		await selectKinderChildAndDismiss(page);
	});

	test('ホーム画面', async ({ page }) => {
		// 活動カードが描画されるまで待機
		await expect(page.locator('[data-testid^="activity-card-"]').first()).toBeVisible();
		await expect(page).toHaveScreenshot('preschool-home.png', DYNAMIC_SCREENSHOT_OPTIONS);
	});

	test('ステータス画面', async ({ page }) => {
		await page.goto('/preschool/status');
		await expect(page.getByTestId('growth-chart-heading')).toBeVisible();
		await expect(page).toHaveScreenshot('preschool-status.png', SCREENSHOT_OPTIONS);
	});

	// 実績画面は #322 で廃止（チャレンジ管理に転用）

	test('履歴画面', async ({ page }) => {
		await page.goto('/preschool/history');
		await expect(page.getByTestId('tab-today')).toBeVisible();
		await expect(page).toHaveScreenshot('preschool-history.png', DYNAMIC_SCREENSHOT_OPTIONS);
	});
});
