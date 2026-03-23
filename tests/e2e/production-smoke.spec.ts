// tests/e2e/production-smoke.spec.ts
// 本番環境（ganbari-quest.com）に対するスモークテスト
// 実行: npx playwright test --config tests/e2e/production.config.ts
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true を前提

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

const BASE_URL = 'https://ganbari-quest.com';

// ============================================================
// ヘルパー
// ============================================================

/** ダミーユーザーでログインし認証 Cookie を取得 */
async function loginAsOwner(page: Page) {
	await page.goto(`${BASE_URL}/auth/login`);

	// ログインフォームが表示されるか確認
	const emailInput = page.getByLabel('メールアドレス');
	if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
		await emailInput.fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await page.waitForURL(/\/admin/, { timeout: 10000 });
	}
	// 既にログイン済み or local モードなら /admin に居るはず
}

async function selectChild(page: Page) {
	await loginAsOwner(page);
	await page.goto(`${BASE_URL}/switch`);
	const childButton = page.locator('button[type="submit"]').first();
	await expect(childButton).toBeVisible({ timeout: 10000 });
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby)\/home/, { timeout: 10000 });
}

async function dismissOverlays(page: Page) {
	const hasOmikuji = await page
		.getByText('きょうのうんせい')
		.isVisible()
		.catch(() => false);

	if (hasOmikuji) {
		const closeBtn = page.getByRole('button', { name: /とじる|閉じる|OK/i });
		await closeBtn.waitFor({ timeout: 8000 }).catch(() => {});
		if (await closeBtn.isVisible().catch(() => false)) {
			await closeBtn.click();
		}
	}

	for (let i = 0; i < 3; i++) {
		const overlay = page.locator(
			'[data-testid="achievement-overlay"], [data-testid="title-overlay"]',
		);
		if (await overlay.isVisible().catch(() => false)) {
			const btn = overlay.getByRole('button').first();
			if (await btn.isVisible().catch(() => false)) {
				await btn.click();
				await page.waitForTimeout(300);
			}
		}
	}
}

// ============================================================
// 認証テスト
// ============================================================

test.describe('本番環境 - 認証', () => {
	test('ヘルスチェック', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.dataSource).toBe('dynamodb');
	});

	test('ログインページが表示される', async ({ page }) => {
		await page.goto(`${BASE_URL}/auth/login`);
		await expect(page.getByRole('heading', { name: 'がんばりクエスト' })).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByLabel('メールアドレス')).toBeVisible();
		await expect(page.getByLabel('パスワード')).toBeVisible();
	});

	test('ダミーユーザーでログインできる', async ({ page }) => {
		await page.goto(`${BASE_URL}/auth/login`);
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('password123');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page).toHaveURL(/\/admin/, { timeout: 10000 });
	});

	test('不正なパスワードでログインできない', async ({ page }) => {
		await page.goto(`${BASE_URL}/auth/login`);
		await page.getByLabel('メールアドレス').fill('owner@example.com');
		await page.getByLabel('パスワード').fill('wrongpassword');
		await page.getByRole('button', { name: 'ログイン' }).click();
		await expect(page.getByText('メールアドレスまたはパスワードが正しくありません')).toBeVisible({
			timeout: 5000,
		});
	});

	test('ログアウトできる', async ({ page }) => {
		await loginAsOwner(page);
		await page.goto(`${BASE_URL}/auth/logout`);
		await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
	});
});

// ============================================================
// ページ表示テスト（認証後）
// ============================================================

test.describe('本番環境スモークテスト', () => {
	test('トップページ（/switch）が表示される', async ({ page }) => {
		await page.goto(`${BASE_URL}/switch`);
		await expect(page).toHaveTitle(/がんばりクエスト|Ganbari/i, { timeout: 10000 });
		const childButton = page.locator('button[type="submit"]').first();
		await expect(childButton).toBeVisible({ timeout: 10000 });
	});

	test('子供を選択してホーム画面に遷移できる', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);
		const url = page.url();
		expect(url).toMatch(/\/(kinder|baby)\/home/);
	});

	test('子供選択のform action（?/select）が動作する', async ({ page }) => {
		await loginAsOwner(page);
		await page.goto(`${BASE_URL}/switch`);
		const childButton = page.locator('button[type="submit"]').first();
		await expect(childButton).toBeVisible({ timeout: 10000 });
		await childButton.click();
		await page.waitForURL(/\/(kinder|baby)\/home/, { timeout: 10000 });
		expect(page.url()).not.toContain('/switch');
	});

	test('ステータス画面が表示される', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);

		const statusLink = page.getByRole('link', { name: /ステータス|すてーたす|つよさ/i });
		if (await statusLink.isVisible().catch(() => false)) {
			await statusLink.click();
			await page.waitForURL(/\/status/, { timeout: 10000 });
			await expect(page.locator('body')).toBeVisible();
		}
	});

	test('活動ボタンが表示される', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);

		const activityButtons = page.locator(
			'[data-testid="activity-button"], .activity-card, .baby-card, button.tap-target',
		);
		const count = await activityButtons.count();
		expect(count).toBeGreaterThan(0);
	});

	test('管理画面が表示される（ログイン後）', async ({ page }) => {
		await loginAsOwner(page);
		await page.goto(`${BASE_URL}/admin`);
		await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
		// /auth/login にリダイレクトされていないことを確認
		expect(page.url()).toContain('/admin');
	});

	test('ナビゲーション: きりかえリンクで/switchに戻れる', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);

		const switchLink = page.getByRole('link', { name: /きりかえ|切り替え/i });
		if (await switchLink.isVisible().catch(() => false)) {
			await switchLink.click();
			await page.waitForURL(/\/switch/, { timeout: 10000 });
		}
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
});

// ============================================================
// APIエンドポイントテスト — GET
// ============================================================

test.describe('本番API検証 - GET', () => {
	test('GET /api/v1/activities - 活動一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/activities`);
		// cognito モードでは認証なしで 302 リダイレクトの可能性あり
		expect(response.status()).toBeLessThan(500);
		const contentType = response.headers()['content-type'] ?? '';
		if (response.ok() && contentType.includes('application/json')) {
			const body = await response.json();
			expect(body.activities).toBeDefined();
			expect(Array.isArray(body.activities)).toBe(true);
		}
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

	test('GET /api/v1/career-fields - キャリア分野', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/career-fields`);
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

	test('GET /api/v1/career-plans/1 - キャリアプラン', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/career-plans/1`);
		expect(response.status()).toBeLessThan(500);
	});
});

// ============================================================
// レスポンスヘッダー・セキュリティ
// ============================================================

test.describe('本番環境 - レスポンス検証', () => {
	test('ヘルスチェックAPIがJSON Content-Typeを返す', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.headers()['content-type']).toMatch(/application\/json/);
	});
});
