// tests/e2e/plan-gated-features.spec.ts
// #776: プラン別ゲート UI の E2E 検証
//
// ローカル auth モードでは plan-limit-service の resolvePlanTier が
// 早期 return で常に 'family' を返すため、プランゲートを E2E で検証できない。
// この spec は AUTH_MODE=cognito + COGNITO_DEV_MODE=true 前提で実行し、
// DevCognitoAuthProvider のプラン別ダミーユーザー（free/standard/family）で
// ログイン → 実際のプランゲート UI を検証する。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-gated-features
//
// 対応ゲート:
//  - /admin/rewards: rewards-upgrade-banner（free のみ表示）
//  - /admin/messages: ひとことメッセージボタン（free/standard は disabled、family は enabled）

import { expect, test } from '@playwright/test';
import { loginAsPlan as loginAs, warmupAdminPages } from './plan-login-helpers';

// Vite dev のコールドコンパイルで /auth/login と /admin 配下の初回ビルドが
// 数分かかることがあるため、テスト前に warmup でプリコンパイルを走らせる。
test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupAdminPages(browser, ['/admin/rewards', '/admin/messages']);
});

// ============================================================
// /admin/rewards — #728 カスタムごほうびプランゲート
// ============================================================
test.describe('#776 /admin/rewards プランゲート', () => {
	test.beforeEach(() => {
		test.slow(); // Vite dev のコールドコンパイルでタイムアウトを 3x 延長
	});

	test('free プランではアップグレードバナーが表示される', async ({ page }) => {
		await loginAs(page, 'free');
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toBeVisible();
		await expect(page.getByTestId('rewards-upgrade-cta')).toBeVisible();
	});

	test('standard プランではアップグレードバナーが表示されない', async ({ page }) => {
		await loginAs(page, 'standard');
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});

	test('family プランではアップグレードバナーが表示されない', async ({ page }) => {
		await loginAs(page, 'family');
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});
});

// ============================================================
// /admin/messages — #0270 自由テキストメッセージプランゲート
// ============================================================
test.describe('#776 /admin/messages プランゲート', () => {
	test.beforeEach(() => {
		test.slow();
	});

	test('free プランではひとことメッセージボタンが disabled', async ({ page }) => {
		await loginAs(page, 'free');
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeDisabled();
	});

	test('standard プランでもひとことメッセージボタンは disabled（family 限定）', async ({
		page,
	}) => {
		await loginAs(page, 'standard');
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeDisabled();
	});

	test('family プランではひとことメッセージボタンが有効', async ({ page }) => {
		await loginAs(page, 'family');
		await page.goto('/admin/messages');
		const textBtn = page.getByRole('button', { name: /ひとことメッセージ/ });
		await expect(textBtn).toBeVisible();
		await expect(textBtn).toBeEnabled();
	});
});
