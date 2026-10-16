/**
 * scripts/capture-specs/flows/point-unit-leftovers-5085.mjs (#5085)
 *
 * ポイント単位の取りこぼし 2 箇所の before/after 撮影。
 *   1. /setup/activities-defaults の「ポイント表示: 「…」」案内
 *   2. /admin/challenges のページガイド「今週のカードの見方」(報酬の単位)
 * AUTH_MODE=local (npm run dev) で、子供がいなければ setup ウィザードを歩いて作る。
 *
 * 使用例:
 *   node scripts/capture.mjs --flow point-unit-leftovers-5085 --url /setup/children \
 *     --actions scripts/capture-specs/flows/point-unit-leftovers-5085.mjs \
 *     --base-url http://localhost:5183 --presets desktop --out tmp/screenshots/pr-5085/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5183';
const PREFIX = process.env.CAPTURE_PREFIX || 'after';

/** @param {import('playwright').Page} page */
async function walkToActivitiesDefaults(page) {
	await page.goto(`${BASE_URL}/setup/activities-defaults`);
	await page.waitForLoadState('domcontentloaded');
	if (/\/setup\/activities-defaults/.test(page.url())) return;
	await page.goto(`${BASE_URL}/setup/children`);
	await page.getByLabel('ニックネーム').fill('てすとくん');
	await page.getByLabel('年齢').fill('8');
	await page.getByRole('button', { name: '追加する' }).click();
	await page.getByRole('button', { name: '次へ' }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.getByRole('button', { name: '次へ' }).click();
	await page.waitForURL(/\/setup\/questionnaire/, { timeout: 15_000 });
	await page.locator('form[action="?/skip"] button[type="submit"]').click();
	await page.waitForURL(/\/setup\/packs/, { timeout: 15_000 });
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('form button[type="submit"]:not([formaction])');
			return btn && !btn.disabled;
		},
		{ timeout: 15_000 },
	);
	await page.locator('form button[type="submit"]:not([formaction])').click();
	await page.waitForURL(/\/setup\/rewards/, { timeout: 15_000 });
	await page.getByText('おすすめセットを自動で追加してすすむ').click();
	await page.getByRole('button', { name: 'スキップして次へ' }).click();
	await page.waitForURL(/\/setup\/rules/, { timeout: 15_000 });
	await page.getByText('おすすめルールを自動で追加してすすむ').click();
	await page.getByRole('button', { name: 'スキップして次へ' }).click();
	await page.waitForURL(/\/setup\/activities-defaults/, { timeout: 15_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await walkToActivitiesDefaults(page);
	await page.getByText('ポイント表示').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture(`${PREFIX}-setup-defaults`);

	// チャレンジが 1 件以上ないとガイドの「今週のカード」step が出ないので、setup で追加する
	await page
		.getByTestId('setup-activities-defaults-apply')
		.click()
		.catch(() => {});
	await page.waitForURL(/\/setup\/challenges/, { timeout: 15_000 }).catch(() => {});
	await page
		.locator('form[action="?/addChallenges"] button[type="submit"]')
		.first()
		.click()
		.catch(() => {});

	await page.goto(`${BASE_URL}/admin/challenges`);
	await page.waitForLoadState('domcontentloaded');
	const welcome = page.locator('.welcome-overlay .welcome-cta');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) await welcome.click();
	const guideBtn = page.locator('[data-tutorial="page-guide-btn"]').first();
	await guideBtn.waitFor({ state: 'visible', timeout: 60_000 });
	await guideBtn.click({ force: true });
	const bubble = page.locator('.guide-bubble');
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });
	for (let i = 0; i < 12; i++) {
		const text = (await bubble.textContent()) ?? '';
		if (text.includes('今週のカード')) break;
		const next = bubble.locator('.guide-nav-next');
		if (((await next.textContent()) ?? '').includes('かんりょう')) break;
		await next.click();
		await page.waitForFunction(
			(prev) => document.querySelector('.guide-bubble')?.textContent !== prev,
			text,
			{ timeout: 5_000 },
		);
	}
	await page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))),
	);
	await capture(`${PREFIX}-challenges-guide`);
};
