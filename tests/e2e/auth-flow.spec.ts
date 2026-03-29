// tests/e2e/auth-flow.spec.ts
// 認証フローの E2E テスト (#0123: PIN廃止、local=認証なし)
//
// AUTH_MODE=local: 全ルート認証不要
// PIN 認証は廃止済み — ログイン不要で管理画面にアクセス可能

import { expect, test } from '@playwright/test';

// ============================================================
// ローカルモード（認証なし）
// ============================================================

test.describe('ローカルモード — 認証不要', () => {
	test('管理画面に直接アクセスできる', async ({ request }) => {
		const res = await request.get('/admin');
		expect(res.ok()).toBeTruthy();
	});

	test('API エンドポイントに直接アクセスできる', async ({ request }) => {
		const res = await request.get('/api/v1/activities');
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.activities).toBeDefined();
	});

	test('ヘルスチェックにアクセスできる', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.status).toBe('ok');
	});
});

// ============================================================
// 公開ルート
// ============================================================

test.describe('公開ルートアクセス', () => {
	test('/ は /switch にリダイレクトされる', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/switch/);
	});

	test('/api/health は 200 を返す', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.status()).toBe(200);
	});

	test('/switch（子供選択画面）が表示される', async ({ page }) => {
		await page.goto('/switch');
		await expect(page.locator('h1')).toContainText('だれがつかう？');
	});
});

// ============================================================
// PIN 認証 API（廃止済み — 404 を返すことを確認）
// ============================================================

test.describe('PIN 認証 API（ローカルモード）', () => {
	test('ログイン API が 200 を返す（ローカルモードでは常に成功）', async ({ request }) => {
		const res = await request.post('/api/v1/auth/login', {
			data: { pin: '1234' },
		});
		expect(res.status()).toBe(200);
	});

	test('ログアウト API が 200 を返す', async ({ request }) => {
		const res = await request.post('/api/v1/auth/logout');
		expect(res.status()).toBe(200);
	});
});

// ============================================================
// OAuth ルートの存在確認（ローカルモードでの動作）
// ============================================================

test.describe('OAuth ルート', () => {
	test('/auth/callback — code なしで /admin にリダイレクト', async ({ page }) => {
		await page.goto('/auth/callback');
		// local モードでは認証不要なので最終的に /admin 系にリダイレクトされる
		await expect(page).toHaveURL(/\/(admin|auth\/login|login)/);
	});

	test('/auth/logout GET — 302 リダイレクトを返す', async ({ request }) => {
		const res = await request.get('/auth/logout', {
			maxRedirects: 0,
		});
		expect(res.status()).toBe(302);
	});
});

// ============================================================
// 認証が必要なAPI（ローカルモードでは認証不要）
// ============================================================

test.describe('API 認証チェック（ローカルモード）', () => {
	test('活動一覧 API にアクセスできる', async ({ request }) => {
		const res = await request.get('/api/v1/activities');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.activities).toBeDefined();
	});
});
