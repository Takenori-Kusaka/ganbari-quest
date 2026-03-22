// tests/e2e/production-smoke.spec.ts
// 本番環境（ganbari-quest.com）に対するスモークテスト
// 実行: npx playwright test --config tests/e2e/production.config.ts

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

const BASE_URL = 'https://ganbari-quest.com';

// ============================================================
// ヘルパー
// ============================================================
async function selectChild(page: Page) {
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
// ページ表示テスト
// ============================================================

test.describe('本番環境スモークテスト', () => {
	test('ヘルスチェック', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.dataSource).toBe('dynamodb');
	});

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

		const statusLink = page.getByRole('link', { name: /ステータス|すてーたす/i });
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
			'[data-testid="activity-button"], .activity-card, .baby-card',
		);
		const count = await activityButtons.count();
		expect(count).toBeGreaterThan(0);
	});

	test('管理画面が表示される', async ({ page }) => {
		await page.goto(`${BASE_URL}/admin`);
		await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
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
// APIエンドポイントテスト（正しいルート構造に基づく）
// ============================================================

test.describe('本番API検証', () => {
	test('GET /api/v1/activities - 活動一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/activities`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.activities).toBeDefined();
		expect(Array.isArray(body.activities)).toBe(true);
	});

	test('GET /api/v1/status/1 - 子供ステータス', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/status/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/points/1 - ポイント残高', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/points/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/achievements/1 - 実績一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/achievements/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/login-bonus/1 - ログインボーナス', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/login-bonus/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/career-fields - キャリア分野', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/career-fields`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/evaluations/1 - 週次評価', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/evaluations/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/special-rewards/1 - 特別ごほうび', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/special-rewards/1`);
		expect(response.status()).toBe(200);
	});

	test('POST /api/v1/children/1/avatar - ファイルなしで400', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/children/1/avatar`, {
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		});
		// 500ではなく400が返ること（S3対応の確認）
		expect(response.status()).toBe(400);
		const body = await response.json();
		expect(body.message).toContain('ファイルを選択');
	});

	test('POST /api/v1/activity-logs - 活動記録', async ({ request }) => {
		// 活動一覧を取得
		const activitiesRes = await request.get(`${BASE_URL}/api/v1/activities`);
		const body = await activitiesRes.json();
		const activities = body.activities ?? body;
		if (!Array.isArray(activities) || activities.length === 0) return;

		const activityId = activities[0].id;
		const response = await request.post(`${BASE_URL}/api/v1/activity-logs`, {
			data: { childId: 1, activityId },
		});
		expect(response.status()).toBeLessThan(500);
	});

	test('GET /api/v1/activities/999999 - 存在しない活動は404', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/activities/999999`);
		expect(response.status()).toBe(404);
	});
});
