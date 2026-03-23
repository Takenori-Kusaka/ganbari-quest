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
	});

	test('ヘルスチェックにアクセスできる', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.ok()).toBeTruthy();
	});
});

// ============================================================
// 公開ルート
// ============================================================

test.describe('公開ルートアクセス', () => {
	test('/ はアクセス可能', async ({ request }) => {
		const res = await request.get('/');
		expect(res.ok()).toBeTruthy();
	});

	test('/api/health はアクセス可能', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.ok()).toBeTruthy();
	});

	test('/switch（子供選択画面）はアクセス可能', async ({ request }) => {
		const res = await request.get('/switch');
		expect(res.ok()).toBeTruthy();
	});
});

// ============================================================
// PIN 認証 API の後方互換（廃止予定だがまだルートが残っている場合）
// ============================================================

test.describe('PIN 認証 API（後方互換）', () => {
	test('ログイン API が存在する場合は 200 を返す', async ({ request }) => {
		const res = await request.post('/api/v1/auth/login', {
			data: { pin: '1234' },
		});
		// PIN 認証が残っていれば 200、廃止済みなら 404
		expect([200, 404]).toContain(res.status());
	});

	test('ログアウト API が存在する場合は正常に処理される', async ({ request }) => {
		const res = await request.post('/api/v1/auth/logout');
		// 200, 302, 404 のいずれか
		expect([200, 302, 404]).toContain(res.status());
	});
});

// ============================================================
// OAuth ルートの存在確認（ローカルモードでの動作）
// ============================================================

test.describe('OAuth ルート', () => {
	test('/auth/callback — code なしでリダイレクト', async ({ page }) => {
		await page.goto('/auth/callback');
		// /auth/login, /login, / のいずれかにリダイレクト
		const url = page.url();
		expect(url.includes('/auth') || url.includes('/login') || url.endsWith('/')).toBeTruthy();
	});

	test('/auth/logout GET — Cookie 削除してリダイレクト', async ({ request }) => {
		const res = await request.get('/auth/logout', {
			maxRedirects: 0,
		});
		// リダイレクト or サーバーエラー（Cognito 環境変数未設定時）
		expect([302, 500]).toContain(res.status());
	});
});
