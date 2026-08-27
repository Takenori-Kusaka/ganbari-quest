/**
 * scripts/capture-specs/flows/lp-age-panel-primary.mjs (#4714)
 *
 * site/index.html の年齢別パネルは既定で「幼児 (3-5)」タブが開いており、
 * 「小学生以上 (6-18)」パネルは非表示のため、`--section` 単発撮影では撮れない。
 * タブを user-gesture で切り替えてから撮影する再利用可能な flow。
 * 年齢パネル / soft-features の文言を変える LP PR で再利用してください。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://127.0.0.1:5280 node scripts/capture.mjs \
 *     --flow lp-age-panel-primary \
 *     --url /index.html \
 *     --actions scripts/capture-specs/flows/lp-age-panel-primary.mjs \
 *     --presets desktop,mobile \
 *     --out tmp/screenshots/pr-XXXX/
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5280';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
	await page.locator('body').waitFor({ state: 'visible', timeout: 15_000 });
	// applyLpKeys() の data-lp-key 注入完了まで待つ (注入前に撮ると fallback テキストが写る)
	await waitForStablePage(page);

	// 「小学生以上 (6-18)」タブへ切り替え、パネルが表示されるまで待つ
	const tab = page.locator('#age-tab-primary-plus');
	await tab.waitFor({ state: 'visible', timeout: 15_000 });
	await tab.click();
	await page.locator('#age-panel-primary-plus').waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('#age-panel').scrollIntoViewIfNeeded();
	await page.evaluate(() => window.scrollBy({ top: -80, left: 0, behavior: 'instant' }));
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture('age-panel-primary');

	// soft-features (成長レポートカード) も同一 page で撮る
	await page.locator('#soft-features').scrollIntoViewIfNeeded();
	await page.evaluate(() => window.scrollBy({ top: -80, left: 0, behavior: 'instant' }));
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture('soft-features');
};
