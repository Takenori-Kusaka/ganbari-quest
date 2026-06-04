/**
 * scripts/capture-specs/flows/admin-page-guide-2905.mjs
 *
 * #2905 (EPIC #2897): admin 各ページの ❓ ページガイド復旧の視覚証跡。
 * #2294 EPIC で新設された checklists / challenges + status ページを
 * page-guide-registry に登録し、❓ ボタン → PageGuideOverlay が開く様子を撮る。
 *
 * 本番ルートを demo Lambda 同型 env (AUTH_MODE=anonymous + DATA_SOURCE=demo) で
 * 起動した dev server 上で開き、user-gesture で ❓ を click した overlay 表示状態を撮影する。
 *
 * 使用例 (BASE_URL は demo Lambda env で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-page-guide-2905 \
 *     --url /admin/checklists \
 *     --actions scripts/capture-specs/flows/admin-page-guide-2905.mjs \
 *     --presets desktop \
 *     --pr <N>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_OVERLAY = '[role="dialog"][aria-labelledby="page-guide-title"]';

/** #2294 EPIC で新設され #2905 で復旧した 3 ページ + 1 既存ページ */
const PAGES = [
	{ path: '/admin/checklists', label: 'page-guide-checklists' },
	{ path: '/admin/challenges', label: 'page-guide-challenges' },
	{ path: '/admin/status', label: 'page-guide-status' },
];

/** admin home 初回訪問時の PremiumWelcome overlay が ❓ click を遮るため閉じる */
async function dismissWelcome(page) {
	const welcome = page.locator('.welcome-overlay');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) {
		const cta = welcome.locator('.welcome-cta');
		if (await cta.isVisible().catch(() => false)) {
			await cta.click();
			await welcome.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
		}
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const { path, label } of PAGES) {
		await page.goto(`${BASE_URL}${path}`);
		await page.waitForLoadState('domcontentloaded');
		await dismissWelcome(page);

		// ❓ ボタンが presence (= registry 登録済) であることを待つ
		const btn = page.locator(GUIDE_BTN);
		await btn.waitFor({ state: 'visible', timeout: 15_000 });

		// click → PageGuideOverlay が開く (dead-end でない)
		await btn.first().click({ force: true });
		await page.locator(GUIDE_OVERLAY).waitFor({ state: 'visible', timeout: 5_000 });
		// spotlight ring / bubble の transition / layout commit を確実に待つ
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);
		await capture(label);

		// 次ページのため overlay を閉じる
		await page.keyboard.press('Escape');
		await page
			.locator(GUIDE_OVERLAY)
			.waitFor({ state: 'hidden', timeout: 5_000 })
			.catch(() => {});
	}
};
