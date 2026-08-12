/**
 * scripts/capture-specs/flows/lp-faq-cancel-4496.mjs (#4496)
 *
 * site/faq.html の解約 / 退会まわりの回答は `<details>` の中にあり、既定では閉じている。
 * そのため静的な全画面キャプチャでは**回答本文が 1 文字も写らない** (before / after が
 * pixel 一致してしまい、SS が変更の証跡にならない)。本 flow は該当 `<details>` を開いた
 * 状態にしてから撮影する。
 *
 * 撮影対象:
 *   - faq-cancel  : 「途中で解約するとどうなりますか？」(#cancel) + 「解約後に再開できますか？」
 *   - faq-deletion: 「退会・アカウント削除はすぐにできますか？」
 *
 * 使用例 (before / after で同じ flow を別サーバに当てて撮り比べる):
 *   BASE_URL=http://localhost:5282 node scripts/capture.mjs \
 *     --flow lp-faq-cancel-4496 \
 *     --url /faq.html \
 *     --actions scripts/capture-specs/flows/lp-faq-cancel-4496.mjs \
 *     --presets desktop,mobile \
 *     --out tmp/ss-after/
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5280';

/**
 * summary のテキストで `<details>` を特定して開き、その位置までスクロールする。
 * data-lp-key は SSOT 注入前後で変わらないためキーで引く (文言変更に強い)。
 *
 * @param {import('playwright').Page} page
 * @param {string} summaryLpKey 例: 'faqB.k18'
 */
async function openDetailsBySummaryKey(page, summaryLpKey) {
	const opened = await page.evaluate((key) => {
		const summary = document.querySelector(`summary[data-lp-key="${key}"]`);
		const details = summary?.closest('details');
		if (!details) return false;
		details.open = true;
		details.scrollIntoView({ block: 'center', behavior: 'instant' });
		return true;
	}, summaryLpKey);
	if (!opened) {
		throw new Error(`details not found for summary[data-lp-key="${summaryLpKey}"]`);
	}
	await waitForStablePage(page, { skipNetworkIdle: true });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/faq.html`, { waitUntil: 'domcontentloaded' });
	await page.locator('body').waitFor({ state: 'visible', timeout: 15_000 });
	// applyLpKeys() による SSOT 注入 (ADR-0025) の完了を待つ
	await waitForStablePage(page);

	// 解約: 「途中で解約するとどうなりますか？」+ 「解約後に再開することはできますか？」
	await openDetailsBySummaryKey(page, 'faqB.k18');
	await openDetailsBySummaryKey(page, 'faqB.k26');
	await openDetailsBySummaryKey(page, 'faqB.k18');
	await capture('faq-cancel');

	// 退会: 「退会・アカウント削除はすぐにできますか？」
	await openDetailsBySummaryKey(page, 'faqB.k75');
	await capture('faq-deletion');
};
