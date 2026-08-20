/**
 * scripts/capture-specs/flows/child-shop-completed-badge-4631.mjs (#4631)
 *
 * 「承認 / 却下が済んだ交換を陳列棚に残さない」ことを撮る SS フロー。
 *   1. ごほうびショップ 一覧 (approved / rejected 済みのカードにバッジが残っていないか)
 *   2. 「記録 > 交換」(却下理由が読めるか = ショップからの導線の着地点)
 *
 * develop (修正前) でも同じ file を渡して before SS を撮れるよう、存在しない要素には触れない。
 * 撮影前の seed (approved 1 件 + rejected 1 件 + 残高) は呼び出し側が用意する。
 *
 * 使用例 (AUTH_MODE=local の dev server、専用 port):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5199 node scripts/capture.mjs \
 *     --flow child-shop-completed-badge-4631 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-shop-completed-badge-4631.mjs \
 *     --presets mobile \
 *     --base-url http://localhost:5199 \
 *     --out tmp/screenshots/pr-<N>/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** @param {import('playwright').Page} page */
async function dismissOverlays(page) {
	for (let i = 0; i < 4; i++) {
		const dialog = page.locator('[data-part="content"][data-state="open"]').first();
		if ((await dialog.count()) === 0) return;
		const closeBtn = dialog
			.locator('button')
			.filter({ hasText: /とじる|やったね|閉じる|OK|わかった|つぎへ|おわり/ })
			.first();
		if ((await closeBtn.count()) > 0) await closeBtn.click().catch(() => {});
		await dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
	}
}

/** @param {import('playwright').Page} page */
async function selectChild(page) {
	await page.context().clearCookies();
	for (let i = 0; i < 5; i++) {
		await page.goto(`${BASE_URL}/switch`);
		await dismissOverlays(page);
		const card = page.locator('[data-testid^="child-select-"]').first();
		await card.waitFor({ state: 'visible', timeout: 15_000 });
		await card.click({ timeout: 10_000 }).catch(() => {});
		try {
			await page.waitForURL(/\/(preschool|elementary|junior|senior|baby)\//, { timeout: 10_000 });
			return new URL(page.url()).pathname.split('/')[1];
		} catch {
			// 次のループで再試行
		}
	}
	throw new Error('お子さま選択から子供画面へ遷移できなかった');
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	const uiMode = await selectChild(page);

	// 1. 陳列棚 (完了した交換のバッジが残っていないか / 履歴導線があるか)
	await page.goto(`${BASE_URL}/${uiMode}/shop`);
	await page.getByTestId('shop-page').waitFor({ state: 'visible', timeout: 20_000 });
	await dismissOverlays(page);
	await page.evaluate(() => window.scrollTo(0, 0));
	await capture('ごほうびショップ 完了した交換のあと');

	// 2. 記録 > 交換 (却下理由の着地点)
	await page.goto(`${BASE_URL}/${uiMode}/history?kind=purchases`);
	await page
		.locator('[data-testid="history-list-purchases"], [data-testid="history-empty-purchases"]')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	await dismissOverlays(page);
	await page.evaluate(() => window.scrollTo(0, 0));
	await capture('記録 > 交換 (却下理由の着地点)');
};
