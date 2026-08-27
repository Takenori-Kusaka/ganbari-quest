/**
 * scripts/capture-specs/flows/members-packs-guide-3268.mjs
 * PR #3268 (#3260 C4): /admin/members の ? ページガイド overlay を撮影。
 * (#4691: /admin/packs はページごと撤去したため対象は members のみ。file 名は履歴互換で維持。)
 */
import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const TARGET = 'members';

export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/${TARGET}`);
	await page.waitForLoadState('domcontentloaded');
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
	const dialog = page.locator('[role="dialog"][aria-labelledby="page-guide-title"]');
	await dialog.waitFor({ state: 'visible', timeout: 8_000 });
	// ① 概要 → ② 画面の見方 へ「つぎへ」で進む
	await dialog.getByRole('button', { name: /つぎへ/ }).click();
	// step 2 の進捗（「2 / N」）になり吹き出しが確定するまで待つ（遷移途中の空吹き出し回避）
	await page.locator('.guide-header-progress', { hasText: /^2 \// }).waitFor({
		state: 'visible',
		timeout: 6_000,
	});
	await page
		.waitForFunction(
			() => {
				const el = document.querySelector('[role="dialog"][aria-labelledby="page-guide-title"]');
				return el !== null && Number(getComputedStyle(el).opacity) >= 0.99;
			},
			{ timeout: 5_000 },
		)
		.catch(() => {});
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture(`${TARGET}-guide`);
};
