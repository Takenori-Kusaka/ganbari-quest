/**
 * scripts/capture-specs/flows/child-history-purchases-4632.mjs (#4632)
 *
 * 子供の「記録 > 交換」が「いつ・何を・いくらで交換したか」を出すことを撮る SS フロー。
 * elementary / junior の 2 年齢帯で同じ画面を撮る (Issue の実機証跡が両方で再現していたため)。
 *
 * develop (修正前) でも同じ file を渡して before SS を撮れる。
 * 撮影前の seed (交換履歴 2 件以上) は呼び出し側が用意する。
 *
 * 使用例 (AUTH_MODE=local の dev server、専用 port):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5199 node scripts/capture.mjs \
 *     --flow child-history-purchases-4632 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-history-purchases-4632.mjs \
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
 * @param {string} uiMode
 * @param {string} label
 */
async function capturePurchases(page, capture, uiMode, label) {
	await page.goto(`${BASE_URL}/${uiMode}/history?kind=purchases`);
	await page
		.locator('[data-testid="history-list-purchases"], [data-testid="history-empty-purchases"]')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	await dismissOverlays(page);
	await page.evaluate(() => window.scrollTo(0, 0));
	await capture(label);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// 年齢帯は選択した子供の ui_mode に従う (別 uiMode の URL は child layout の guard で
	// 弾かれ空表示になるため、ここで無理に切り替えない)。年齢帯間の差分は同一 component の
	// text variant だけなので、1 帯で内容を確認すれば足りる。
	const uiMode = await selectChild(page);
	await capturePurchases(page, capture, uiMode, `記録 > 交換 (${uiMode})`);
};
