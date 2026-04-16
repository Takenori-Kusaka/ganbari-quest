// tests/e2e/trial-flow.spec.ts
// #752: トライアル開始→アクティブ→終了の全遷移 E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で実行。
// - dev-tenant-free: トライアル未使用の free ユーザー
// - dev-tenant-trial-expired: トライアル期限切れ済みの free ユーザー
//   （global-setup.ts で trial_history に過去日レコードをシード）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts trial-flow

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginAsPlan, warmupAdminPages } from './plan-login-helpers';

test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupAdminPages(browser, ['/admin', '/admin/license']);
});

test.describe('#752 トライアルフロー', () => {
	// MUST: テスト 3 はテスト 2 でトライアルが開始された状態に依存するため serial 実行必須
	// fullyParallel: true（playwright.cognito-dev.config.ts）との矛盾を解消
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(() => {
		test.slow(); // Vite dev のコールドコンパイルでタイムアウトを 3x 延長
	});

	// テスト 2 で dev-tenant-free のトライアルを開始するため、
	// テスト終了後にクリーンアップして plan-free.spec.ts への副作用を防ぐ
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
					`[trial-flow cleanup] Removed ${result.changes} trial record(s) for dev-tenant-free.`,
				);
			}
		} finally {
			db.close();
		}
	});

	// ========================================================
	// 1. 未使用 free ユーザーにトライアル開始導線が表示
	// ========================================================
	test('free ユーザーに TrialBanner の「開始」状態が表示される', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin', { waitUntil: 'commit', timeout: 180_000 });

		const banner = page.getByTestId('trial-banner-not-started');
		await expect(banner).toBeVisible({ timeout: 30_000 });
		// "7日間 無料で試す" ボタンが存在
		await expect(page.getByTestId('trial-banner-start-button')).toBeVisible();
		// バナーに「7日間、全機能を無料で試せます」テキスト
		await expect(banner).toContainText('7日間');
	});

	// ========================================================
	// 2. 「7日間無料で試す」ボタンでトライアル開始 → active 状態
	// ========================================================
	test('トライアル開始ボタンクリック → active バナーに切り替わる', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin', { waitUntil: 'commit', timeout: 180_000 });

		// 「開始」バナーが表示されるまで待機
		await page
			.getByTestId('trial-banner-start-button')
			.waitFor({ state: 'visible', timeout: 30_000 });

		// トライアル開始ボタンをクリック
		await page.getByTestId('trial-banner-start-button').click();

		// ページが更新されてアクティブバナーに切り替わる
		// active バナーには "残りN日" テキストが表示される
		await expect(page.getByText(/無料体験中/)).toBeVisible({ timeout: 30_000 });
		// CTA「プランを見る」リンクが表示される
		await expect(page.getByTestId('trial-banner-active-cta')).toBeVisible();
		// 「開始」バナーは消える
		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
	});

	// ========================================================
	// 3. トライアル開始後 — /admin/license でトライアルステータス表示
	// ========================================================
	test('トライアル開始後に /admin/license でトライアル情報が表示される', async ({ page }) => {
		// Note: 前のテストでトライアルが開始されている前提（同一 tenant DB が共有）
		await loginAsPlan(page, 'free');
		await page.goto('/admin/license', { waitUntil: 'commit', timeout: 180_000 });

		// トライアルセクションが表示される（active 状態）。
		// /admin/license では TrialBanner（+layout.svelte 由来）と
		// PlanStatusCard の両方が「残り○日」を表示するため、
		// getByText(/残り.*日/) は strict mode 違反になる。
		// PlanStatusCard 側の testid でピンポイントに検証する。
		await expect(page.getByTestId('plan-status-trial-badge')).toBeVisible({ timeout: 30_000 });
	});

	// ========================================================
	// 4. トライアル期限切れユーザー — expired バナー表示
	// ========================================================
	test('トライアル期限切れユーザーに expired バナーが表示される', async ({ page }) => {
		await loginAsPlan(page, 'trial-expired');
		await page.goto('/admin', { waitUntil: 'commit', timeout: 180_000 });

		const expiredBanner = page.getByTestId('trial-banner-expired');
		await expect(expiredBanner).toBeVisible({ timeout: 30_000 });
		// 「無料体験が終了しました」テキスト
		await expect(expiredBanner).toContainText('終了');
		// アップグレード CTA が表示される
		await expect(page.getByTestId('trial-banner-expired-cta')).toBeVisible();
	});

	// ========================================================
	// 5. 期限切れユーザー — 再トライアル開始ボタンが存在しない
	// ========================================================
	test('トライアル使用済みユーザーには「開始」ボタンが表示されない', async ({ page }) => {
		await loginAsPlan(page, 'trial-expired');
		await page.goto('/admin', { waitUntil: 'commit', timeout: 180_000 });

		// expired バナーが表示されるまで待つ
		await page.getByTestId('trial-banner-expired').waitFor({ state: 'visible', timeout: 30_000 });
		// 「開始」ボタンは表示されない（trialUsed=true なので canStartTrial=false）
		await expect(page.getByTestId('trial-banner-start-button')).toHaveCount(0);
	});

	// ========================================================
	// 6. 期限切れ後に /admin/license でトライアル終了状態が表示される
	// ========================================================
	test('期限切れ後の /admin/license でトライアル終了が反映される', async ({ page }) => {
		await loginAsPlan(page, 'trial-expired');
		await page.goto('/admin/license', { waitUntil: 'commit', timeout: 180_000 });

		// license ページの PlanStatusCard が free を示す
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
	});
});
