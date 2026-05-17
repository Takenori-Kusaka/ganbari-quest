// tests/e2e/demo-lambda/bug4-switch-click.spec.ts
//
// Bug 4 (#2097 Phase B / PR-B4 #2204): demo Lambda 上で `/switch` の子供カードを
// クリックしても `/<uiMode>/home` に遷移せず `/switch` のまま留まる回帰テスト。
//
// 根本原因 (`src/lib/server/demo/demo-mode.ts` §DEMO_WRITE_ALLOWLIST):
//   - `/switch?/select` form action は POST request
//   - hooks.server.ts の `shouldReturnDemoNoop` が POST を一律 no-op 化していた
//   - no-op response は `{ ok: true, demo: true }` を返すだけで redirect(303) を発火しない
//   - 結果: form submit 後も SvelteKit が `/switch` に留まり、子供を選べない
//
// 修正 (PR-B4 #2204):
//   - DEMO_WRITE_ALLOWLIST に `/switch` を追加
//   - `/switch` POST は no-op せず本番 route handler を駆動させる
//   - route handler は実 DB write せず cookie set + redirect(303) のみ (demo 安全)
//
// 本 spec は demo Lambda 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo) 上で
// 子供クリックが正しく `/<uiMode>/home` に遷移することを検証する。
// 本番 cognito E2E では再現不可 (`/switch` POST は実 DB write が走る) ため、
// demo Lambda 専用 spec として独立配置する。

import { expect, test } from '@playwright/test';

test.describe('Bug 4: /switch クリックで子供選択が動作する (demo Lambda)', () => {
	test('ひなちゃん (902, preschool) を選ぶと /preschool/home に遷移する', async ({ page }) => {
		await page.goto('/switch');

		// 5 人の子供カードが表示される (demo-data.ts DEMO_CHILDREN)
		const hina = page.getByTestId('child-select-902');
		await expect(hina).toBeVisible();

		// クリック前に URL が /switch であること
		await expect(page).toHaveURL(/\/switch$/);

		// クリック → form submit → redirect(303) → /preschool/home
		await hina.click();

		// 遷移先 URL 検証 (Bug 4 では /switch のまま留まっていた)
		await expect(page).toHaveURL(/\/preschool\/home/, { timeout: 10_000 });
	});

	test('けんたくん (903, elementary) を選ぶと /elementary/home に遷移する', async ({ page }) => {
		await page.goto('/switch');
		const kenta = page.getByTestId('child-select-903');
		await expect(kenta).toBeVisible();

		await kenta.click();
		await expect(page).toHaveURL(/\/elementary\/home/, { timeout: 10_000 });
	});

	test('さくらちゃん (904, junior) を選ぶと /junior/home に遷移する', async ({ page }) => {
		await page.goto('/switch');
		const sakura = page.getByTestId('child-select-904');
		await expect(sakura).toBeVisible();

		await sakura.click();
		await expect(page).toHaveURL(/\/junior\/home/, { timeout: 10_000 });
	});

	test('けいすけくん (906, senior) を選ぶと /senior/home に遷移する', async ({ page }) => {
		await page.goto('/switch');
		const keisuke = page.getByTestId('child-select-906');
		await expect(keisuke).toBeVisible();

		await keisuke.click();
		await expect(page).toHaveURL(/\/senior\/home/, { timeout: 10_000 });
	});

	test('たろうくん (901, baby) を選ぶと baby uiMode の home に遷移する', async ({ page }) => {
		// 901 は age=1 で getDefaultUiMode(1)='baby' に該当
		await page.goto('/switch');
		const taro = page.getByTestId('child-select-901');
		await expect(taro).toBeVisible();

		await taro.click();
		// baby uiMode の home。子供 routes の (child)/[uiMode=uiMode]/home パラメータルート
		await expect(page).toHaveURL(/\/baby\/home/, { timeout: 10_000 });
	});

	test('/switch POST レスポンスが redirect になっている (no-op 化されていない)', async ({
		page,
	}) => {
		await page.goto('/switch');

		// form submission の POST response を観測する
		// SvelteKit 2 の form action では redirect 時は 303 + Location header を返す
		// (use:enhance enabled でも redirect は raw HTTP 303、本番準拠)。
		// もし demo no-op 化されていれば 200 + `{ ok: true, demo: true }` JSON が返る。
		const responsePromise = page.waitForResponse(
			(res) => res.url().includes('/switch') && res.request().method() === 'POST',
		);

		await page.getByTestId('child-select-902').click();
		const res = await responsePromise;

		// redirect response であること (303 status + Location ヘッダ)
		// no-op 化されていれば 200 になる。
		expect(res.status()).toBe(303);
		const location = res.headers().location ?? '';
		expect(location).toMatch(/\/preschool\/home/);
	});
});
