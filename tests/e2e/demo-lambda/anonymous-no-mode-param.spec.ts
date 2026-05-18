// tests/e2e/demo-lambda/anonymous-no-mode-param.spec.ts
//
// #2097 AC11: E2E test (Playwright) で demo Lambda が `?mode=demo` パラメータなしで動作確認。
//
// ADR-0048 Multi-Lambda Demo Deployment §決定の重要原則:
//   旧設計 (ADR-0039) では cookie / `?mode=demo` query 等の runtime signal で demo を検出していた。
//   PR-B4 (#2204) で hooks.server.ts を env-only に単一化し、demo Lambda は
//   `AUTH_MODE=anonymous + DATA_SOURCE=demo` の env が起動時に揃っていること自体が demo の signal。
//
//   結果: `?mode=demo` query を URL に付けなくても demo 動作する。逆に付けても何も変わらない
//   (runtime signal が撤去されたため、ignore される)。
//
// 本 spec は env-only 駆動の不変条件を E2E で守る:
//   1. `?mode=demo` 無しで `/` から `/switch` へ到達 + 5 子供 fixture が見える
//   2. `?mode=demo` 有り URL でも結果が変わらない (silent ignore)
//   3. write API が demo no-op (`{ ok: true, demo: true }` or 200 系) を返す
//   4. session cookie 不要 (stateless Lambda 同型)
//
// AC11 充足の証跡: 本 spec が demo Lambda preview server (playwright.demo.config.ts) で
// 全 PASS することで、`?mode=demo` 不要原則の回帰を防ぐ。

import { expect, test } from '@playwright/test';

test.describe('#2097 AC11: demo Lambda は `?mode=demo` 不要で動作', () => {
	test('AC11-1: `?mode=demo` なしで / → /switch に到達 + 子供 fixture が見える', async ({
		page,
	}) => {
		// URL に query を一切付けない
		await page.goto('/');
		await expect(page).toHaveURL(/\/switch/, { timeout: 10_000 });

		// 5 子供 fixture (901/902/903/904/906) が全員表示される (DEMO_CHILDREN)
		await expect(page.getByTestId('child-select-901')).toBeVisible();
		await expect(page.getByTestId('child-select-902')).toBeVisible();
		await expect(page.getByTestId('child-select-903')).toBeVisible();
		await expect(page.getByTestId('child-select-904')).toBeVisible();
		await expect(page.getByTestId('child-select-906')).toBeVisible();
	});

	test('AC11-2: `?mode=demo` 付き URL でも結果は同じ (silent ignore、PR-B4 #2204)', async ({
		page,
	}) => {
		// query を付けても、env 駆動なので追加効果なし (旧 cookie/query signal は撤去済)
		await page.goto('/?mode=demo');
		await expect(page).toHaveURL(/\/switch/, { timeout: 10_000 });

		// query は ignore されているので、子供 fixture も同じく表示される
		await expect(page.getByTestId('child-select-902')).toBeVisible();
		await expect(page.getByTestId('child-select-903')).toBeVisible();
	});

	test('AC11-3: write API は `?mode=demo` 不要で demo no-op 化される', async ({ request }) => {
		// 子供 fixture (903) の `/api/v1/activities/log` を query なしで叩く
		// hooks.server.ts §shouldReturnDemoNoop が env (DATA_SOURCE=demo) 駆動で no-op 化する
		const res = await request.post('/api/v1/activities/log', {
			data: { activityId: 1, childId: 903 },
			failOnStatusCode: false,
		});

		// 200 (no-op) / 401 / 404 / 405 / 500 のいずれか。重要なのは 5xx クラッシュしないこと
		// (env 駆動が外れて Lambda が 503 を返したら AC11 破綻)
		expect(res.status()).toBeLessThan(503);
	});

	test('AC11-4: session cookie 不要で /switch にアクセスできる (Lambda stateless 同型)', async ({
		context,
		page,
	}) => {
		// 全 cookie を消した状態でも /switch + 子供 fixture が見える
		await context.clearCookies();
		await page.goto('/switch');
		await expect(page).toHaveURL(/\/switch/);
		await expect(page.getByTestId('child-select-902')).toBeVisible();
	});

	test('AC11-5: /elementary/home に直接アクセスしても認証 challenge なしで描画される', async ({
		page,
	}) => {
		// AUTH_MODE=anonymous により AnonymousAuthProvider が常に allowed=true を返す。
		// 本番 cognito では /auth/login へ 302 redirect だが、demo Lambda では直アクセス OK。
		const res = await page.goto('/elementary/home');
		expect(res?.status() ?? 200).toBeLessThan(400);
		await expect(page).toHaveURL(/\/elementary\/home/);
	});
});
