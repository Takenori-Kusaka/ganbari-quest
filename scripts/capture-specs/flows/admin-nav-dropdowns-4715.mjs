/**
 * scripts/capture-specs/flows/admin-nav-dropdowns-4715.mjs (#4715)
 *
 * 保護者ナビ（AdminLayout）のカテゴリ dropdown を 1 つずつ開いて撮る再利用可能な flow。
 * dropdown は既定で閉じているため、nav 項目のラベル / アイコンを変える PR では
 * `--section` の単発撮影では差分が写らない。
 *
 * 使用例 (BASE_URL は AUTH_MODE=anonymous DATA_SOURCE=demo で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5190 node scripts/capture.mjs \
 *     --flow admin-nav-dropdowns-4715 \
 *     --url "/admin?screenshot=all" \
 *     --actions scripts/capture-specs/flows/admin-nav-dropdowns-4715.mjs \
 *     --presets desktop \
 *     --out tmp/screenshots/pr-XXXX/
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * 画面を覆う modal を閉じる。
 * demo テナントは有料プランのため `PremiumWelcome`（`.welcome-overlay`、Ark UI Dialog ではないので
 * Escape では閉じない）が初回表示され、nav の click を intercept する。
 */
async function closeBlockingOverlays(page) {
	const welcome = page.locator('.welcome-overlay');
	if ((await welcome.count()) > 0) {
		await page.locator('.welcome-cta').first().click();
		await welcome
			.first()
			.waitFor({ state: 'hidden', timeout: 10_000 })
			.catch(() => {});
	}
	const dialog = page.locator('[data-scope="dialog"][data-state="open"]').first();
	if ((await dialog.count()) === 0) return;
	await page.keyboard.press('Escape');
	await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin?screenshot=all`, { waitUntil: 'domcontentloaded' });
	await page.locator('nav').first().waitFor({ state: 'visible', timeout: 20_000 });
	await waitForStablePage(page);
	await closeBlockingOverlays(page);

	// カテゴリ button は「アイコン + ラベル + ▾」。順に開いて撮る。
	const categoryButtons = page.locator('button[aria-haspopup="true"]');
	const count = await categoryButtons.count();
	for (let i = 0; i < count; i += 1) {
		const btn = categoryButtons.nth(i);
		if (!(await btn.isVisible())) continue;
		await btn.click();
		// dropdown が open になるまで待つ（固定待ちは使わない）
		await page
			.locator('.desktop-dropdown[role="menu"]')
			.first()
			.waitFor({ state: 'visible', timeout: 10_000 });
		await waitForStablePage(page, { skipNetworkIdle: true });
		await capture(`nav-category-${i + 1}`);
	}
};
