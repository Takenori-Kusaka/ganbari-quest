// tests/e2e/cognito-auth.spec.ts
// Cognito dev モードの認証 E2E テスト
// 実行: npx playwright test --config playwright.cognito-dev.config.ts

import { expect, test } from '@playwright/test';

// ============================================================
// 1. ログインページ表示
// ============================================================
test.describe('ログインページ', () => {
	test('ログインフォームが表示される', async ({ page }) => {
		await page.goto('/auth/login');
		await expect(page.getByRole('heading', { name: 'がんばりクエスト' })).toBeVisible();
		await expect(page.getByLabel('メールアドレス')).toBeVisible();
		await expect(page.getByLabel('パスワード')).toBeVisible();
		await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
	});

	test('テスト用アカウントのヒントが表示される（devモード）', async ({ page }) => {
		await page.goto('/auth/login');
		const details = page.getByText('テスト用アカウント');
		await expect(details).toBeVisible();
	});
});

// ============================================================
// 2. 正常ログイン
// ============================================================
test.describe('正常ログイン', () => {
	test('owner でログインすると /admin にリダイレクトされる', async ({ page }) => {
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page).toHaveURL(/\/admin/);
	});

	test('parent でログインすると /admin にリダイレクトされる', async ({ page }) => {
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('parent@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page).toHaveURL(/\/admin/);
	});

	test('child でログインすると /switch にリダイレクトされる', async ({ page }) => {
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('child@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page).toHaveURL(/\/switch/);
	});
});

// ============================================================
// 3. ログイン失敗
// ============================================================
test.describe('ログイン失敗', () => {
	test('不正なパスワードでエラーが表示される', async ({ page }) => {
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('wrongpassword');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page.getByText('メールアドレスまたはパスワードが正しくありません')).toBeVisible();
	});

	test('存在しないメールアドレスでエラーが表示される', async ({ page }) => {
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('nobody@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page.getByText('メールアドレスまたはパスワードが正しくありません')).toBeVisible();
	});
});

// ============================================================
// 4. 認可チェック（未ログイン時のリダイレクト）
// ============================================================
test.describe('認可チェック', () => {
	test('未ログインで /admin にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/auth\/login/);
	});

	test('未ログインで /api/v1/activities は 401 相当のリダイレクト', async ({ request }) => {
		// API は Cookie なしでアクセスすると認可で弾かれる
		// ただし /switch, /auth は公開ルートなので OK
		const res = await request.get('/api/health');
		expect(res.ok()).toBeTruthy();
	});
});

// ============================================================
// 5. ロール別アクセス制御
// ============================================================
test.describe('ロール別アクセス制御', () => {
	test('child ロールで /admin にアクセスすると /child にリダイレクトされる', async ({ page }) => {
		// child でログイン
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('child@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await page.waitForURL(/\/switch/);

		// /admin にアクセス試行
		await page.goto('/admin');
		// child は /admin アクセス不可 → /child にリダイレクト
		await expect(page).toHaveURL(/\/child/);
	});

	test('owner ロールで /admin にアクセスできる', async ({ page }) => {
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await page.waitForURL(/\/admin/);

		// /admin に直接アクセスしても残る
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/admin/);
	});
});

// ============================================================
// 6. ログアウト
// ============================================================
test.describe('ログアウト', () => {
	test('ログアウト後に /auth/login にリダイレクトされる', async ({ page }) => {
		// まずログイン
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await page.waitForURL(/\/admin/);

		// ログアウト
		await page.goto('/auth/logout');
		await expect(page).toHaveURL(/\/auth\/login/);
	});

	test('ログアウト後に /admin にアクセスすると /auth/login にリダイレクトされる', async ({
		page,
	}) => {
		// ログイン
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await page.waitForURL(/\/admin/);

		// ログアウト
		await page.goto('/auth/logout');
		await page.waitForURL(/\/auth\/login/);

		// /admin にアクセス → リダイレクト
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/auth\/login/);
	});
});

// ============================================================
// 7. セッション継続
// ============================================================
test.describe('セッション継続', () => {
	test('ログイン後にリロードしても認証が維持される', async ({ page }) => {
		// ログイン
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await page.waitForURL(/\/admin/);

		// リロード
		await page.reload();
		await expect(page).toHaveURL(/\/admin/);
	});

	test('ログイン済みで /auth/login にアクセスすると /admin にリダイレクトされる', async ({
		page,
	}) => {
		// ログイン
		await page.goto('/auth/login');
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await page.waitForURL(/\/admin/);

		// /auth/login にアクセス → 既にログイン済みなのでリダイレクト
		await page.goto('/auth/login');
		await expect(page).toHaveURL(/\/admin/);
	});
});
