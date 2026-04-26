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
// #1535: loginAsPlan() を storageState ベースに移行
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-free

import { expect, test } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/free.json' });

test.describe('#751 free プラン — 機能ゲート', () => {
	test('/admin/license の PlanStatusCard が free を示し、アップグレード CTA が見える', async ({
		page,
	}) => {
		await page.goto('/admin/license');
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
		// free 専用のアップグレード CTA が表示される
		await expect(page.getByTestId('plan-status-free-cta')).toBeVisible();
		// トライアル中バッジは出ない（dev-tenant-free はトライアル未開始想定）
		await expect(page.getByTestId('plan-status-trial-badge')).toHaveCount(0);
	});

	test('/admin ホームに無料プラン用 PlanStatusCard が表示される', async ({ page }) => {
		await page.goto('/admin');
		// free のときは PlanStatusCard が data-plan-tier="free" で表示される
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
		// free 専用のアップグレード CTA が表示される
		await expect(page.getByTestId('plan-status-free-cta')).toBeVisible();
	});

	test('/admin/reports — weekly-report-upsell バナーが表示される', async ({ page }) => {
		await page.goto('/admin/reports');
		// #735: 無料プラン向け upsell はタブの外に出し、ページ到達時点で常に表示される
		await expect(page.getByTestId('weekly-report-upsell')).toBeVisible();
	});

	test('/admin/settings — エクスポートはアップセル表示で disabled', async ({ page }) => {
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
		await page.goto('/admin/activities');
		// Svelte ハイドレーション完了を待つ（FAB の onclick ハンドラ束縛を保証）。
		// FAB の確実な可視化で ready 状態を検知する（auto-retry assertion）。
		const fab = page.getByTestId('add-activity-fab');
		await expect(fab).toBeVisible({ timeout: 15_000 });

		// FAB から追加ダイアログを開き、AI モードを選択
		// （AiSuggestPanel は Dialog 内 addMode='ai' のときのみ描画される）
		await fab.click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
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
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toBeVisible();
		await expect(page.getByTestId('rewards-upgrade-cta')).toBeVisible();
	});

	test('/admin/messages — ひとことメッセージは disabled（family 限定機能）', async ({ page }) => {
		// plan-gated-features.spec.ts と意図的に重複させ、free 単体でも完結する
		// 機能疎通スイートにする
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeDisabled();
	});
});
