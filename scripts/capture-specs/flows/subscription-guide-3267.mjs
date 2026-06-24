/**
 * scripts/capture-specs/flows/subscription-guide-3267.mjs
 * PR #3291 (#3260 C3): /admin/subscription の ? ページガイド overlay を撮影。
 */
import { waitForStablePage } from '../../lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5191';

export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/subscription`);
	await page.waitForLoadState('domcontentloaded');
	// welcome overlay があれば閉じる
	const welcome = page.locator('.welcome-overlay');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) {
		await welcome
			.locator('.welcome-cta')
			.click()
			.catch(() => {});
		await welcome.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
	}
	const btn = page.locator('[data-tutorial="page-guide-btn"]');
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	await btn.first().click({ force: true });
	await page
		.locator('[role="dialog"][aria-labelledby="page-guide-title"]')
		.waitFor({ state: 'visible', timeout: 8_000 });
	// overlay の出現アニメ + フォント/レイアウト確定を待つ (waitForTimeout は scripts/ で禁止 #1208)
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture('subscription-guide');
};
