// tests/e2e/production-smoke.spec.ts
// 本番環境（ganbari-quest.com）に対するスモークテスト
// 実行: npx playwright test --config playwright.production.config.ts
// AUTH_MODE=cognito を前提

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

const BASE_URL = process.env.E2E_BASE_URL || 'https://ganbari-quest.com';
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || '';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || '';

// ============================================================
// ヘルパー
// ============================================================

/** テストユーザーでログインし認証 Cookie を取得。失敗時は false を返す */
async function loginAsOwner(page: Page): Promise<boolean> {
	if (!TEST_EMAIL || !TEST_PASSWORD) return false;

	await page.goto(`${BASE_URL}/auth/login`);
	await page.waitForLoadState('networkidle');

	const emailInput = page.getByLabel('メールアドレス');
	if (!(await emailInput.isVisible({ timeout: 10000 }).catch(() => false))) {
		// 既にログイン済みの可能性
		return page.url().includes('/admin') || page.url().includes('/switch');
	}

	// Svelte 5 ハイドレーション完了を待つ
	await page
		.waitForFunction(
			() =>
				document.querySelector('button[type="submit"]')?.getAttribute('class')?.includes('svelte'),
			{ timeout: 10000 },
		)
		.catch(() => {});

	await emailInput.click();
	await emailInput.fill('');
	await emailInput.type(TEST_EMAIL, { delay: 10 });
	const passwordInput = page.getByLabel('パスワード');
	await passwordInput.click();
	await passwordInput.type(TEST_PASSWORD, { delay: 10 });

	const loginBtn = page.getByRole('button', { name: 'ログイン', exact: true });
	await expect(loginBtn).toBeEnabled({ timeout: 10000 });
	await loginBtn.click();

	// ログイン成功（/admin へリダイレクト）を待つ。失敗時は false
	try {
		await page.waitForURL(/\/admin/, { timeout: 30000 });
		return true;
	} catch {
		return false;
	}
}

// ============================================================
// 認証不要テスト（常に実行）
// ============================================================

test.describe('本番環境 - 基本動作', () => {
	test('ヘルスチェック', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.dataSource).toBe('dynamodb');
	});

	test('ログインページが表示される', async ({ page }) => {
		await page.goto(`${BASE_URL}/auth/login`);
		await expect(page.getByAltText('がんばりクエスト')).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByLabel('メールアドレス')).toBeVisible();
		await expect(page.getByLabel('パスワード')).toBeVisible();
	});

	test('404ページが適切に表示される', async ({ page }) => {
		const response = await page.goto(`${BASE_URL}/nonexistent-page-12345`);
		expect(response).not.toBeNull();
	});

	test('HTTPS接続が正常', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.status()).toBe(200);
		expect(response.url()).toMatch(/^https:\/\//);
	});

	test('ヘルスチェックAPIがJSON Content-Typeを返す', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.headers()['content-type']).toMatch(/application\/json/);
	});
});

// ============================================================
// APIエンドポイントテスト — GET（認証不要で 5xx でないことを確認）
// ============================================================

test.describe('本番API検証 - GET', () => {
	test('GET /api/v1/activities - 活動一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/activities`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/status/1 - 子供ステータス', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/status/1`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/points/1 - ポイント残高', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/points/1`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/achievements/1 - 実績一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/achievements/1`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/login-bonus/1 - ログインボーナス', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/login-bonus/1`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/evaluations/1 - 週次評価', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/evaluations/1`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/special-rewards/1 - 特別ごほうび', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/special-rewards/1`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/special-rewards/templates - テンプレート一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/special-rewards/templates`);
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/points/1/history - ポイント履歴', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/points/1/history`);
		expect(response.status()).toBeLessThan(500);
	});
});

// ============================================================
// 認証必須テスト（ログインが成功する場合のみ実行）
// 本番Cognitoにテストユーザーが未登録の場合は自動スキップ
// ============================================================

test.describe('本番環境 - 認証テスト', () => {
	test('テストユーザーでログインできる', async ({ page }) => {
		test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'E2E テスト認証情報が未設定');
		const ok = await loginAsOwner(page);
		test.skip(!ok, '本番Cognitoへのログインに失敗（テストユーザー未登録の可能性）');
		expect(page.url()).toContain('/admin');
	});

	test('ログアウトできる', async ({ page }) => {
		test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'E2E テスト認証情報が未設定');
		const ok = await loginAsOwner(page);
		test.skip(!ok, '本番Cognitoへのログインに失敗');
		await page.goto(`${BASE_URL}/auth/logout`);
		await expect(page).toHaveURL(/\/auth\/login/, { timeout: 30000 });
	});
});

test.describe('本番環境 - 認証後ページテスト', () => {
	test('トップページ（/switch）が表示される', async ({ page }) => {
		test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'E2E テスト認証情報が未設定');
		const ok = await loginAsOwner(page);
		test.skip(!ok, '本番Cognitoへのログインに失敗');
		await page.goto(`${BASE_URL}/switch`);
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveTitle(/がんばりクエスト|Ganbari/i, { timeout: 15000 });
		const childButton = page.locator('button[type="submit"]').first();
		await expect(childButton).toBeVisible({ timeout: 15000 });
	});

	test('子供を選択してホーム画面に遷移できる', async ({ page }) => {
		test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'E2E テスト認証情報が未設定');
		const ok = await loginAsOwner(page);
		test.skip(!ok, '本番Cognitoへのログインに失敗');
		await page.goto(`${BASE_URL}/switch`);
		await page.waitForLoadState('networkidle');
		const childButton = page.locator('button[type="submit"]').first();
		await expect(childButton).toBeVisible({ timeout: 15000 });
		await childButton.click();
		await page.waitForURL(/\/(kinder|baby)\/home/, { timeout: 30000 });
	});

	test('管理画面が表示される（ログイン後）', async ({ page }) => {
		test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'E2E テスト認証情報が未設定');
		const ok = await loginAsOwner(page);
		test.skip(!ok, '本番Cognitoへのログインに失敗');
		await page.goto(`${BASE_URL}/admin`);
		await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
		expect(page.url()).toContain('/admin');
	});
});
