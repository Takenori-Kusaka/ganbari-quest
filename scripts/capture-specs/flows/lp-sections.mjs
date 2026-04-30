/**
 * scripts/capture-specs/flows/lp-sections.mjs (#1706 #1707 #1712 — PR #1759 導入)
 *
 * site/index.html の Hero + 4 中核セクション（versus / machine-tour / soft-features / growth-roadmap）を
 * セクション別に撮影する再利用可能な flow。
 * --server-mode lp で動作。LP の中核セクション改修系 PR で再利用してください。
 *
 * 使用例:
 *   node scripts/capture.mjs \
 *     --flow lp-sections \
 *     --url /index.html \
 *     --actions scripts/capture-specs/flows/lp-sections.mjs \
 *     --server-mode lp \
 *     --presets desktop,mobile \
 *     --out tmp/screenshots/pr-XXXX/
 */

import { waitForStablePage } from '../../lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5280';

/**
 * セクションを画面中央へ寄せて撮影する。
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {(label: string) => Promise<string>} capture
 * @param {string} label
 */
async function captureSection(page, selector, capture, label) {
	const el = await page.$(selector);
	if (!el) {
		console.warn(`[lp-sections-1759] selector not found: ${selector}`);
		return;
	}
	await el.scrollIntoViewIfNeeded();
	// scroll-margin / sticky header を考慮し、少しスクロール戻して見出しが切れないようにする
	await page.evaluate(() => window.scrollBy({ top: -80, left: 0, behavior: 'instant' }));
	// scroll 後の reflow / lazy image 描画を待つ (#1208 — waitForTimeout 不可)
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture(label);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
	// LP body が描画されるまで待機
	await page.locator('body').waitFor({ state: 'visible', timeout: 15_000 });
	// applyLpKeys() の data-lp-key 注入完了を待つ（DOMContentLoaded 後に同期実行）
	// networkidle + フォント・rAF 安定で applyLpKeys 完了後を保証する
	await waitForStablePage(page);

	// 1. Hero（上から見える状態を確保）
	await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture('01-hero');

	// 2. versus セクション (E→A→P 4 行)
	await captureSection(page, '#versus, .versus, [data-lp-section="versus"]', capture, '02-versus');

	// 3. machine-tour セクション (3 つの工夫カード)
	await captureSection(
		page,
		'#machine-tour, .machine-tour, [data-lp-section="machine-tour"]',
		capture,
		'03-machine-tour',
	);

	// 4. soft-features セクション (4 カード)
	await captureSection(
		page,
		'#soft-features, .soft-features, [data-lp-section="soft-features"]',
		capture,
		'04-soft-features',
	);

	// 5. growth-roadmap セクション (5 stage の親主語 H3)
	await captureSection(
		page,
		'#growth-roadmap, .growth-roadmap, [data-lp-section="growth-roadmap"]',
		capture,
		'05-growth-roadmap',
	);
};
