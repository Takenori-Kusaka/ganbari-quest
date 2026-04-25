/**
 * scripts/capture-specs/flows/child-home-preschool.mjs (#1487)
 *
 * preschool モード子供向けホーム UI のスクリーンショットフロー。
 * AUTH_MODE=local (npm run dev) で動作。デモ Cookie を除去してから実行すること。
 *
 * 使用例:
 *   node scripts/capture.mjs \
 *     --flow child-home-preschool \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-home-preschool.mjs \
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

	// /switch でこどもを選択（フォーム POST → /preschool/home へリダイレクト）
	await page.goto('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: 'たろうくん' }).click();

	// ホーム画面が安定するまで待機
	await page.waitForURL(/\/preschool\/home$/);
	await page.locator('[data-testid="preschool-home-page"]').waitFor({ state: 'visible' });
	await capture('preschool ホーム — 幼児モード');
};
