/**
 * scripts/capture-specs/flows/must-card-badge-2146.mjs (#2146)
 *
 * 子供 UI 「今日のおやくそく」カード演出統合の SS 撮影フロー。
 * 旧 must-progress-bar-1757.mjs を置き換え、4 年齢コアモード + baby home の
 * 計 5 視点でホームを撮影する。
 *
 * 使用例:
 *   BASE_URL=http://127.0.0.1:5173 MSYS_NO_PATHCONV=1 \
 *     node scripts/capture.mjs --pr 2146 --flow must-card-badge-2146 --url /switch \
 *     --actions scripts/capture-specs/flows/must-card-badge-2146.mjs --presets desktop,mobile
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** @param {import('playwright').Page} page */
async function clearDemoCookie(page) {
	await page.context().clearCookies();
}

/**
 * @param {import('playwright').Page} page
 * @param {string} childName
 * @param {string} expectedUrlSuffix
 */
async function selectChild(page, childName, expectedUrlSuffix) {
	await page.goto(`${BASE_URL}/switch`);
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`${expectedUrlSuffix}$`));
}

/**
 * @param {import('playwright').Page} page
 * @param {string} mode
 */
async function waitForHome(page, mode) {
	await page.locator(`[data-testid="${mode}-home-page"]`).waitFor({ state: 'visible' });
}

/**
 * @param {import('playwright').Page} page
 */
async function waitForMustCard(page) {
	await page
		.locator('[data-testid^="activity-card-"][data-must="1"]')
		.first()
		.waitFor({ state: 'visible', timeout: 5_000 })
		.catch(() => {});
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await clearDemoCookie(page);

	// preschool — たろうくん (age 4)
	await selectChild(page, 'たろうくん', '/preschool/home');
	await waitForHome(page, 'preschool');
	await waitForMustCard(page);
	await capture('preschool — must カード badge');

	// elementary — けんたくん (age 8)
	await selectChild(page, 'けんたくん', '/elementary/home');
	await waitForHome(page, 'elementary');
	await waitForMustCard(page);
	await capture('elementary — must カード badge');

	// junior — ゆうこちゃん (age 13)
	await selectChild(page, 'ゆうこちゃん', '/junior/home');
	await waitForHome(page, 'junior');
	await waitForMustCard(page);
	await capture('junior — must カード badge');

	// senior — まさとくん (age 16)
	await selectChild(page, 'まさとくん', '/senior/home');
	await waitForHome(page, 'senior');
	await waitForMustCard(page);
	await capture('senior — must カード badge');

	// baby — はなこちゃん（must badge 非表示確認、親準備モード）
	await selectChild(page, 'はなこちゃん', '/baby/home');
	await page.waitForLoadState('domcontentloaded');
	await capture('baby — 親準備モード（must badge 非表示）');
};
