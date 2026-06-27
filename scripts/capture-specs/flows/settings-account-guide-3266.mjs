/**
 * scripts/capture-specs/flows/settings-account-guide-3266.mjs
 * PR #3266 (#3260 C2): /admin/settings/account の ? ページガイド overlay を撮影。
 * PO 指摘「おやカギ変更画面に説明がない」への個別ガイド付与の証跡。
 */
import { waitForStablePage } from '../../lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/settings/account`);
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
	const dialog = page.locator('[role="dialog"][aria-labelledby="page-guide-title"]');
	await dialog.waitFor({ state: 'visible', timeout: 8_000 });
	// fade-in アニメ完了まで opacity が 1 になるのを待つ（waitForTimeout は scripts/ で禁止 #1208）
	await page
		.waitForFunction(
			() => {
				const el = document.querySelector('[role="dialog"][aria-labelledby="page-guide-title"]');
				return el !== null && Number(getComputedStyle(el).opacity) >= 0.99;
			},
			{ timeout: 5_000 },
		)
		.catch(() => {});
	// フォント/レイアウト確定を待つ
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture('settings-account-guide');
};
