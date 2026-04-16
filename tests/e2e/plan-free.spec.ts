// tests/e2e/plan-free.spec.ts
// #751: 無料プランの機能ゲート E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で DevCognitoAuthProvider の
// dev-tenant-free（plan=free）でログインし、
// 「free だからこそ表示される / disabled される」UI を一通り確認する。
//
// 設計意図:
//  - free のときに見えるべきアップセル CTA / locked badge / disabled 状態を
//    positive assertion で押さえる
//  - plan-standard / plan-family の negative assertion とミラー関係になり、
//    プラン境界の回帰検知を双方向で担保する
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-free

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
		'/admin/rewards',
		'/admin/activities',
	]);
});

test.describe('#751 free プラン — 機能ゲート', () => {
	test.beforeEach(() => {
		test.slow(); // Vite dev のコールドコンパイルでタイムアウトを 3x 延長
	});

	test('/admin/license の PlanStatusCard が free を示し、アップグレード CTA が見える', async ({
		page,
	}) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/license');
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
		// free 専用のアップグレード CTA が表示される
		await expect(page.getByTestId('plan-status-free-cta')).toBeVisible();
		// トライアル中バッジは出ない（dev-tenant-free はトライアル未開始想定）
		await expect(page.getByTestId('plan-status-trial-badge')).toHaveCount(0);
	});

	test('/admin ホームに無料プラン用 quick-link が表示される', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin');
		// free のときだけ表示される「無料プラン もっと便利に使いませんか？」リンク
		await expect(page.locator('.plan-quick-link--free')).toBeVisible();
	});

	test('/admin/reports — weekly-report-upsell バナーが表示される', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/reports');
		// 週次メールレポート機能は weekly タブに閉じ込められている。
		// 既定は monthly タブなので、upsell バナーを見るにはタブ切替が必要。
		// Vite dev のコールドコンパイル中は click が hydration 前に着弾して state が
		// 切り替わらないことがあるため、toPass でリトライする。
		const weeklyTab = page.getByRole('button', { name: '週次レポート', exact: true });
		await weeklyTab.waitFor({ state: 'visible', timeout: 30_000 });
		await expect(async () => {
			await weeklyTab.click();
			await expect(page.getByTestId('weekly-report-upsell')).toBeVisible({ timeout: 3_000 });
		}).toPass({ timeout: 30_000 });
	});

	test('/admin/settings — エクスポートはアップセル表示で disabled', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/settings');
		// free 用アップセルカードが見える
		await expect(page.getByTestId('export-upsell')).toBeVisible();
		// data-export-button 自体は disabled 状態（hidden ではなく見せたうえで操作不可）
		const exportBtn = page.getByTestId('data-export-button').first();
		await expect(exportBtn).toBeVisible();
		await expect(exportBtn).toBeDisabled();
	});

	test('/admin/activities — AiSuggestPanel が plan-locked + アップセル CTA を出す', async ({
		page,
	}) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin/activities');
		// AiSuggestPanel は 追加ダイアログの "AIで追加" モード内にのみ描画される。
		// FAB → 追加ダイアログ → "AIで追加" カードを辿って到達する。
		// Vite dev のコールドコンパイル中は click が hydration 前に着弾して
		// ダイアログが開かないことがあるため、toPass でリトライする。
		const fab = page.getByRole('button', { name: '活動を追加' });
		await fab.waitFor({ state: 'visible', timeout: 30_000 });
		const addDialog = page.getByTestId('add-activity-dialog');
		await expect(async () => {
			await fab.click();
			await expect(addDialog).toBeVisible({ timeout: 3_000 });
		}).toPass({ timeout: 30_000 });
		await page.getByRole('button', { name: /AIで追加/ }).click();
		const panel = page.getByTestId('ai-suggest-panel');
		await expect(panel).toBeVisible();
		await expect(panel).toHaveAttribute('data-plan-locked', 'true');
		await expect(page.getByTestId('ai-suggest-locked-badge')).toBeVisible();
		await expect(page.getByTestId('ai-suggest-upgrade-card')).toBeVisible();
		await expect(page.getByTestId('ai-suggest-upgrade-cta')).toBeVisible();
	});

	test('/admin/rewards — アップグレードバナーが表示される', async ({ page }) => {
		// plan-gated-features.spec.ts でも検証済みだが、
		// free プランの正面検証パッケージとしてここでも押さえる
		await loginAsPlan(page, 'free');
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toBeVisible();
		await expect(page.getByTestId('rewards-upgrade-cta')).toBeVisible();
	});

	test('/admin/messages — ひとことメッセージは disabled（family 限定機能）', async ({ page }) => {
		// plan-gated-features.spec.ts と意図的に重複させ、free 単体でも完結する
		// 機能疎通スイートにする
		await loginAsPlan(page, 'free');
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeDisabled();
	});
});
