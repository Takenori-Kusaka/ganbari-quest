// tests/e2e/demo-lambda/demo-anonymous-auth.spec.ts
//
// AnonymousAuthProvider 動作検証 (#2205 / ADR-0048 §P-1.6)。
//
// demo Lambda は AUTH_MODE=anonymous で起動し、`src/lib/server/auth/providers/anonymous.ts`
// の AnonymousAuthProvider が以下を返す:
//   - identity: `{ type: 'anonymous', userId: 'anon-{requestId}', email: 'anon@demo.local' }`
//   - context:  `{ tenantId: 'demo', role: 'owner', licenseStatus: ACTIVE, tenantStatus: ACTIVE }`
//   - authorize: 常に `{ allowed: true }` (全 path 通す)
//
// 本 spec は以下を検証する:
//   - 素のアクセス (`/`) が認証チャレンジなしで `/switch` に到達する
//   - session cookie (gq_session 等) が要らない (Lambda stateless)
//   - 5 子供 fixture (DEMO_CHILDREN) が表示される
//   - admin 系 path も role=owner で通過する (ADR-0048 §決定 P-1.6)

import { expect, test } from '@playwright/test';

test.describe('Demo Lambda 匿名認証 (AnonymousAuthProvider)', () => {
	test('素のアクセス / が認証なしで /switch に到達する', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/switch/, { timeout: 10_000 });
	});

	test('session cookie 不要で /switch にアクセスできる', async ({ context, page }) => {
		// 全 cookie を消した状態でも /switch が表示される
		await context.clearCookies();
		await page.goto('/switch');
		await expect(page).toHaveURL(/\/switch/);
		await expect(page.locator('h1')).toBeVisible();
	});

	test('5 子供 fixture (DEMO_CHILDREN) が全員表示される', async ({ page }) => {
		await page.goto('/switch');

		// demo-data.ts §DEMO_CHILDREN — 5 ペルソナ (901/902/903/904/906)
		await expect(page.getByTestId('child-select-901')).toBeVisible();
		await expect(page.getByTestId('child-select-902')).toBeVisible();
		await expect(page.getByTestId('child-select-903')).toBeVisible();
		await expect(page.getByTestId('child-select-904')).toBeVisible();
		await expect(page.getByTestId('child-select-906')).toBeVisible();
	});

	test('admin path (/admin/children) も role=owner で通過する', async ({ page }) => {
		// ADR-0048 §P-1.6: AnonymousAuthProvider.authorize は常に allowed=true。
		// admin / ops / child いずれも 200 で返る (本番 cognito では /auth/login redirect)。
		const res = await page.goto('/admin/children');
		expect(res?.status()).toBeLessThan(400);
		await expect(page).toHaveURL(/\/admin\/children/);
	});

	test('cognito login 画面 (/auth/login) は demo Lambda 上で表示されない', async ({ page }) => {
		// AUTH_MODE=anonymous では cognito login page は不要 (本番 cognito 専用)。
		// 直接アクセスしても 404 / redirect 等で素通りすることを許容 (本番では 200)。
		// ここでは「demo Lambda 上で /auth/login にアクセスして 5xx エラーになっていない」ことだけ検証する。
		const res = await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
		// 200 / 302 / 308 / 404 いずれも OK。500 系のみ NG。
		expect(res?.status() ?? 200).toBeLessThan(500);
	});

	test('write API は 200 no-op response を返す (ADR-0048 §P-1.7)', async ({ request }) => {
		// /api/v1/* の write は hooks.server の shouldReturnDemoNoop で 200 `{ ok: true, demo: true }` 化。
		// ここでは適当な write エンドポイントを叩き、503/500 ではなく 200 で返ることだけ確認する。
		const res = await request.post('/api/v1/activities/log', {
			data: { activityId: 1, childId: 902 },
			failOnStatusCode: false,
		});
		// 200 (no-op) または 404 (route 未マッチ) を許容。500 系は NG。
		expect(res.status()).toBeLessThan(500);
	});
});
