/**
 * scripts/capture-specs/flows/child-home-baby.mjs (#1487)
 *
 * baby モード子供向け準備モード UI のスクリーンショットフロー。
 * AUTH_MODE=local (npm run dev) で動作。デモ Cookie を除去してから実行すること。
 *
 * 使用例:
 *   node scripts/capture.mjs \
 *     --flow child-home-baby \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-home-baby.mjs \
 *     --presets mobile \
 *     --out tmp/screenshots/
 */

/** @param {import('playwright').Page} page */
async function clearDemoCookie(page) {
	// デモ Cookie が残っていると isDemo=true になり child 一覧が空になる
	await page.context().clearCookies();
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await clearDemoCookie(page);

	// /switch でこどもを選択（フォーム POST → /baby/home へリダイレクト）
	await page.goto('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: 'はなこちゃん' }).click();

	// ホーム画面が安定するまで待機
	await page.waitForURL(/\/baby\/home$/);
	await page.locator('[data-testid="baby-home-page"]').waitFor({ state: 'visible' });
	await capture('baby ホーム — 準備モード');

	// 初期ポイント設定ページ
	await page.locator('[data-testid="initial-points-link"]').click();
	await page.waitForURL(/\/baby\/home\/initial-points/);
	await page.locator('[data-testid="initial-points-page"]').waitFor({ state: 'visible' });
	await capture('初期ポイント設定');
};
