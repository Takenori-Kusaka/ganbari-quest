/**
 * scripts/capture-specs/flows/lp-mobile-nav-open.mjs (#4714)
 *
 * LP のヘッダーナビはモバイル幅ではハンバーガーの中に畳まれているため、
 * `--section header` の単発撮影ではナビ項目の変更が写らない (畳んだ状態は変更前後で同一)。
 * ハンバーガーを開いた状態を撮る再利用可能な flow。LP の nav 構成を変える PR で再利用してください。
 *
 * 撮影対象ページは `--url` ではなく env `LP_NAV_PAGE` で指定する (既定: index.html)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://127.0.0.1:5280 LP_NAV_PAGE=sla.html \
 *     node scripts/capture.mjs \
 *       --flow lp-mobile-nav-open \
 *       --url /sla.html \
 *       --actions scripts/capture-specs/flows/lp-mobile-nav-open.mjs \
 *       --presets mobile \
 *       --out tmp/screenshots/pr-XXXX/
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5280';
const PAGE = process.env.LP_NAV_PAGE || 'index.html';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/${PAGE}`, { waitUntil: 'domcontentloaded' });
	await page.locator('body').waitFor({ state: 'visible', timeout: 15_000 });
	// applyLpKeys() の data-lp-key 注入完了まで待つ
	await waitForStablePage(page);

	const hamburger = page.locator('button.hamburger');
	await hamburger.waitFor({ state: 'visible', timeout: 15_000 });
	await hamburger.click();
	// inline onclick が nav に .open を付けるまで待つ (固定待ちは使わない)
	await page.waitForFunction(
		() => document.querySelector('#main-nav')?.classList.contains('open') === true,
		undefined,
		{ timeout: 10_000 },
	);
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture('nav-open');
};
