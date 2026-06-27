/**
 * scripts/capture-specs/flows/challenges-guide-3270.mjs
 * PR #3270 (#3260 C6): /admin/challenges ガイドに追加した ③最頻操作 step を撮影。
 * ①概要 → つぎへ → ②画面の見方 → つぎへ → ③よく使う操作（3/3）。
 */
import { waitForStablePage } from '../../lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/challenges`);
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
	// ① → ② → ③ へ「つぎへ」で 2 回進む
	await dialog.getByRole('button', { name: /つぎへ/ }).click();
	await page
		.locator('.guide-header-progress', { hasText: /^2 \// })
		.waitFor({ state: 'visible', timeout: 6_000 });
	await dialog.getByRole('button', { name: /つぎへ/ }).click();
	await page
		.locator('.guide-header-progress', { hasText: /^3 \// })
		.waitFor({ state: 'visible', timeout: 6_000 });
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
	await capture('challenges-guide-manage');
};
