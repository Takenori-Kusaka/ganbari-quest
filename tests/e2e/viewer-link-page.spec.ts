// tests/e2e/viewer-link-page.spec.ts
// #4703: プレミアム (family) の閲覧リンク /view/<token> を、リンクを共有された人の
// 立場 (未ログインの別セッション) で開いて確かめる。
//
// ## 旧実装の何が壊れていたか
//
// load が `getPointBalance()` の戻り値 (`PointBalance | { error }`) をそのまま
// `totalPoints` に渡していたため、`.toLocaleString()` が子供全員分
// 「[object Object] ポイント」を描いていた。祖父母に共有したリンクの主表示が壊れていた。
// 無効 / 期限切れ token も汎用 404 に落ちるだけで、リンクの状態が説明されなかった。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts viewer-link-page

import { type Browser, expect, test } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/family.json' });

/** 3 桁区切りの整数。「[object Object]」や NaN はこの形にならない */
const POINT_NUMBER = /^\d{1,3}(,\d{3})*$/;

/**
 * リンクを受け取った人は未ログイン。認証 cookie を引き継がない context を作る。
 * `browser.newContext()` は test の `use` を継承しないので baseURL を明示する。
 */
async function openAsAnonymous(browser: Browser, baseURL: string | undefined, path: string) {
	if (!baseURL) throw new Error('baseURL が解決できませんでした');
	const context = await browser.newContext({ baseURL, storageState: undefined });
	const anonPage = await context.newPage();
	await anonPage.goto(path);
	return { context, anonPage };
}

test.describe('#4703 閲覧リンク /view/<token>', () => {
	test('共有された人 (未ログイン) にポイントが数値で表示される', async ({
		browser,
		baseURL,
		request,
	}) => {
		const res = await request.post('/api/v1/admin/viewer-tokens', {
			data: { label: 'E2E おばあちゃん用', duration: '30d' },
		});
		expect(res.status()).toBe(201);
		const { token } = (await res.json()) as { token: { token: string } };
		expect(token.token).toBeTruthy();

		const { context, anonPage } = await openAsAnonymous(browser, baseURL, `/view/${token.token}`);
		try {
			const stats = anonPage.getByTestId('viewer-child-points');
			await expect(stats.first()).toBeVisible({ timeout: 30_000 });

			const count = await stats.count();
			expect(count).toBeGreaterThan(0);
			for (let i = 0; i < count; i++) {
				const value = (await stats.nth(i).locator('.stat-value').innerText()).trim();
				expect(value).toMatch(POINT_NUMBER);
			}
			// 壊れた表示が 1 つも無いことを画面全体でも確認する
			await expect(anonPage.locator('body')).not.toContainText('[object');
		} finally {
			await context.close();
		}
	});

	test('無効 token は汎用 404 ではなく専用メッセージを出す', async ({ browser, baseURL }) => {
		const { context, anonPage } = await openAsAnonymous(
			browser,
			baseURL,
			'/view/this-token-does-not-exist',
		);
		try {
			const title = anonPage.getByTestId('viewer-token-invalid-title');
			await expect(title).toBeVisible({ timeout: 30_000 });
			await expect(title).toContainText('期限切れ');
		} finally {
			await context.close();
		}
	});
});
