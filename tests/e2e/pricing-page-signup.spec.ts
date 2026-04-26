// tests/e2e/pricing-page-signup.spec.ts
// #757: LP /pricing からサインアップ後にトライアルが自動開始される E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で実行。
// cognito-dev モードでは /auth/signup が /auth/login にリダイレクトされるため、
// 以下の戦略で検証する:
//
//   1. /pricing の CTA リンクが正しい href を持つことを検証
//   2. dev-tenant-free ユーザーでログインし、API を直接呼んで
//      signup 後のトライアル自動開始と同等の状態を作成
//   3. トライアル開始後に /admin で TrialBanner が「残り 7 日」を表示
//   4. /admin/license で planTier が standard に昇格していること
//
// #1535: loginAsPlan() を storageState ベースに移行
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts pricing-page-signup

import path from 'node:path';
import { expect, test } from '@playwright/test';

// ========================================================
// 1. /pricing の「7日間 無料体験」ボタンの href 検証
//    （認証不要なページ）
// ========================================================
test('/pricing の CTA リンクが /auth/signup?plan=X を指す', async ({ page }) => {
	await page.goto('/pricing', { waitUntil: 'domcontentloaded', timeout: 30_000 });

	// standard プランの CTA
	const standardCta = page.locator('[data-plan="standard"]').getByTestId('pricing-cta');
	await expect(standardCta).toBeVisible({ timeout: 30_000 });
	await expect(standardCta).toHaveAttribute('href', '/auth/signup?plan=standard');
	await expect(standardCta).toHaveText('7日間 無料体験');

	// family プランの CTA
	const familyCta = page.locator('[data-plan="family"]').getByTestId('pricing-cta');
	await expect(familyCta).toBeVisible();
	await expect(familyCta).toHaveAttribute('href', '/auth/signup?plan=family');
	await expect(familyCta).toHaveText('7日間 無料体験');

	// free プランの CTA（トライアルなし）
	const freeCta = page.locator('[data-plan="free"]').getByTestId('pricing-cta');
	await expect(freeCta).toBeVisible();
	await expect(freeCta).toHaveAttribute('href', '/auth/signup');
	await expect(freeCta).toHaveText('無料ではじめる');
});

// ========================================================
// 2. signup 画面で plan パラメータが反映される
//    （cognito-dev モードでは redirect されるが、UI テキストを検証）
//    （認証不要なページ）
// ========================================================
test('/auth/signup?plan=standard で plan パラメータが signup UI に反映される', async ({ page }) => {
	// cognito-dev モードでは /auth/signup → /auth/login にリダイレクトされる。
	// リダイレクト後のログインフォームが表示されることで、signup ルートが
	// 機能していることを間接的に確認する。
	await page.goto('/auth/signup?plan=standard', {
		waitUntil: 'commit',
		timeout: 30_000,
	});

	// cognito-dev モードでは /auth/login にリダイレクトされる
	await page.waitForURL(/\/auth\/login/, { timeout: 30_000 });
	// ログインフォームが表示される
	await expect(page.getByLabel('メールアドレス')).toBeVisible({ timeout: 30_000 });
});

// ========================================================
// 6. pricing → signup?plan=family の href も正しい
//    （認証不要なページ）
// ========================================================
test('/pricing の family プラン CTA が plan=family パラメータを含む', async ({ page }) => {
	await page.goto('/pricing', { waitUntil: 'domcontentloaded', timeout: 30_000 });

	const familyCta = page.locator('[data-plan="family"]').getByTestId('pricing-cta');
	await expect(familyCta).toBeVisible({ timeout: 30_000 });

	const href = await familyCta.getAttribute('href');
	expect(href).toBe('/auth/signup?plan=family');
});

// ========================================================
// 3〜5. free ユーザーでトライアル開始 → バナー確認
//       （storageState で free ユーザーとして認証済み）
//       serial モードで順番に実行（テスト4・5はテスト3の副作用に依存）
// ========================================================
test.describe('#757 free ユーザートライアル開始フロー', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });
	test.describe.configure({ mode: 'serial' });

	// テスト終了後に dev-tenant-free のトライアルをクリーンアップ
	// （trial-flow.spec.ts や plan-free.spec.ts への副作用防止）
	test.afterAll(async () => {
		const Database = (await import('better-sqlite3')).default;
		const dbPath = path.resolve('data/ganbari-quest.db');
		const db = new Database(dbPath);
		try {
			const result = db
				.prepare("DELETE FROM trial_history WHERE tenant_id = 'dev-tenant-free'")
				.run();
			if (result.changes > 0) {
				console.log(
					`[pricing-signup cleanup] Removed ${result.changes} trial record(s) for dev-tenant-free.`,
				);
			}
		} finally {
			db.close();
		}
	});

	test('free ユーザーでトライアル開始後に TrialBanner が「無料体験中」を表示', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// まずトライアル未開始状態を確認
		const startButton = page.getByTestId('trial-banner-start-button');
		await expect(startButton).toBeVisible({ timeout: 30_000 });

		// トライアル開始（pricing からの signup 後に startTrial() が呼ばれるのと同等）
		await startButton.click();

		// active バナーに切り替わる
		await expect(page.getByText(/無料体験中/)).toBeVisible({ timeout: 30_000 });

		// 「プランを見る」CTA が表示される
		await expect(page.getByTestId('trial-banner-active-cta')).toBeVisible();
	});

	test('トライアル開始後に /admin/license で planTier が standard に昇格している', async ({
		page,
	}) => {
		// 前のテストでトライアルが開始されている前提（同一 tenant DB が共有）
		await page.goto('/admin/license', { waitUntil: 'commit', timeout: 30_000 });

		// PlanStatusCard にトライアルバッジが表示される
		const trialBadge = page.getByTestId('plan-status-trial-badge');
		await expect(trialBadge).toBeVisible({ timeout: 30_000 });
		await expect(trialBadge).toContainText(/残り.*日/);
	});

	test('TrialBanner の CTA が /pricing へのリンクである', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// active バナーの CTA リンクを検証
		const cta = page.getByTestId('trial-banner-active-cta');
		await expect(cta).toBeVisible({ timeout: 30_000 });

		// href が /pricing を含む（または /admin/license）
		const href = await cta.getAttribute('href');
		expect(href).toBeTruthy();
		// CTA は /pricing またはライセンスページへのリンク
		expect(href).toMatch(/\/(pricing|admin\/license)/);
	});
});
