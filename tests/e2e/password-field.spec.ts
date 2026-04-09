// tests/e2e/password-field.spec.ts
// #615: FormField showToggle + パスワード一致検証のE2Eテスト

import { expect, test } from '@playwright/test';

// auth ページは AUTH_MODE=cognito 時のみアクセス可能。
// local モードではリダイレクトされるためスキップ。
const authMode = process.env.AUTH_MODE ?? 'local';
const isCognitoMode = authMode === 'cognito';

test.describe('#615: パスワードフィールド', () => {
	test.skip(!isCognitoMode, 'AUTH_MODE=cognito でのみ実行可能');

	test.describe('showToggle（パスワード表示切替）', () => {
		test('signup ページでパスワードフィールドに目アイコンが表示される', async ({ page }) => {
			await page.goto('/auth/signup');
			const toggleBtn = page.locator('.password-toggle').first();
			await expect(toggleBtn).toBeVisible();
			await expect(toggleBtn).toHaveAttribute('aria-label', 'パスワードを表示');
		});

		test('目アイコンクリックで input type が password → text に切り替わる', async ({ page }) => {
			await page.goto('/auth/signup');
			const passwordInput = page.locator('input[name="password"]');
			const toggleBtn = page.locator('.password-toggle').first();

			await expect(passwordInput).toHaveAttribute('type', 'password');
			await toggleBtn.click();
			await expect(passwordInput).toHaveAttribute('type', 'text');
			await expect(toggleBtn).toHaveAttribute('aria-label', 'パスワードを非表示');

			await toggleBtn.click();
			await expect(passwordInput).toHaveAttribute('type', 'password');
			await expect(toggleBtn).toHaveAttribute('aria-label', 'パスワードを表示');
		});

		test('login ページでもパスワード表示切替が動作する', async ({ page }) => {
			await page.goto('/auth/login');
			const toggleBtn = page.locator('.password-toggle').first();
			await expect(toggleBtn).toBeVisible();

			const passwordInput = page.locator('input[name="password"]');
			await expect(passwordInput).toHaveAttribute('type', 'password');

			await toggleBtn.click();
			await expect(passwordInput).toHaveAttribute('type', 'text');
		});
	});

	test.describe('パスワード一致検証（signup）', () => {
		test('不一致時に「パスワードが一致しません」が表示される', async ({ page }) => {
			await page.goto('/auth/signup');
			await page.locator('input[name="password"]').fill('TestPass123');
			await page.locator('input[name="passwordConfirm"]').fill('Different456');

			await expect(page.getByText('パスワードが一致しません')).toBeVisible();
		});

		test('一致時に「パスワードが一致しました」が表示される', async ({ page }) => {
			await page.goto('/auth/signup');
			await page.locator('input[name="password"]').fill('TestPass123');
			await page.locator('input[name="passwordConfirm"]').fill('TestPass123');

			await expect(page.getByText('パスワードが一致しました')).toBeVisible();
		});

		test('確認フィールドが空の場合はメッセージが表示されない', async ({ page }) => {
			await page.goto('/auth/signup');
			await page.locator('input[name="password"]').fill('TestPass123');

			await expect(page.getByText('パスワードが一致しません')).not.toBeVisible();
			await expect(page.getByText('パスワードが一致しました')).not.toBeVisible();
		});
	});
});
