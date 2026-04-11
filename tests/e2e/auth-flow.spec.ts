// tests/e2e/auth-flow.spec.ts
// 認証フローの E2E テスト (#0123: PIN廃止、local=認証なし)
//
// AUTH_MODE=local: 全ルート認証不要
// AUTH_MODE=cognito: Cognito 認証（storageState でログイン済み）

import { expect, test } from '@playwright/test';
import { isAwsEnv } from './helpers';

// ============================================================
// 管理画面・APIアクセス（認証モード共通）
// ============================================================

test.describe('管理画面・API アクセス', () => {
	test('管理画面にアクセスできる', async ({ request }) => {
		const res = await request.get('/admin');
		expect(res.ok()).toBe(true);
	});

	test('API エンドポイントにアクセスできる', async ({ request }) => {
		const res = await request.get('/api/v1/activities');
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(body.activities).toBeDefined();
	});

	test('ヘルスチェックにアクセスできる', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.ok()).toBe(true);
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
		// Cognito モードではログイン画面にリダイレクトされる場合もある
		// ただし storageState で認証済みなら /switch に行くはず
		await expect(page).toHaveURL(/\/(switch|auth\/login)/);
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
// PIN 認証 API（ローカルモード専用）
// ============================================================

test.describe('PIN 認証 API（ローカルモード）', () => {
	test.skip(isAwsEnv(), 'AWS 環境では PIN 認証 API は存在しない');

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
// OAuth ルートの存在確認
// ============================================================

test.describe('OAuth ルート', () => {
	test('/auth/callback — code なしでリダイレクト', async ({ page }) => {
		await page.goto('/auth/callback');
		// local モードでは /admin へ、Cognito モードでは /auth/login へリダイレクト
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
// 認証が必要な API
// ============================================================

test.describe('API 認証チェック', () => {
	test('活動一覧 API にアクセスできる', async ({ request }) => {
		const res = await request.get('/api/v1/activities');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.activities).toBeDefined();
	});
});
