/**
 * scripts/capture-specs/flows/settings-hub-guide-3265.mjs
 * PR #3265 (#3260 C1): /admin/settings ハブガイドの ②画面の見方（6グループ俯瞰）step を撮影。
 * 6 グループ全カードを上→下順に案内する改訂版の証跡。
 */
import { waitForStablePage } from '../../lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/settings`);
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
	// ① 概要 → ② 画面の見方（6グループ俯瞰）へ「つぎへ」で進む
	await dialog.getByRole('button', { name: /つぎへ/ }).click();
	// step 2 (settings-hub) の bubble が確定し進捗が「2 / 3」になるまで待つ（遷移途中の空吹き出し回避）
	await page.locator('.guide-bubble[data-step-id="settings-hub"]').waitFor({
		state: 'visible',
		timeout: 8_000,
	});
	await page.locator('.guide-header-progress', { hasText: '2 / 3' }).waitFor({
		state: 'visible',
		timeout: 5_000,
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
	await capture('settings-hub-guide-overview');
};
