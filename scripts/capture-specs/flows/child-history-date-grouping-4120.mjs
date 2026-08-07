/**
 * scripts/capture-specs/flows/child-history-date-grouping-4120.mjs (#4120)
 *
 * 子供の「がんばり履歴」ページの日付見出しグルーピングを撮影するフロー。
 * グルーピング鍵を UTC 暦日 (`log.recordedAt.slice(0, 10)`) から JST 暦日 (`jstDateOfIso`) に
 * 是正した回帰の証跡に使う (JST 00:00〜09:00 に記録された行が前日の見出しに入らないこと)。
 *
 * 使用例 (demo data で seed 済の child を使う):
 *   AUTH_MODE=anonymous DATA_SOURCE=demo npx vite dev --port 5199 --strictPort
 *   node scripts/capture.mjs \
 *     --flow child-history-4120 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-history-date-grouping-4120.mjs \
 *     --base-url http://localhost:5199 \
 *     --presets mobile,desktop \
 *     --out tmp/screenshots/
 */

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// capture.mjs が --url (= /switch) を開いた状態で呼ばれる。origin はそこから取る。
	const base = new URL(page.url()).origin;

	// baby (準備モード) は履歴ページを持たないため、履歴を持つ最初の child を選ぶ。
	const selectors = page.locator('[data-testid^="child-select-"]');
	const count = await selectors.count();
	let uiMode = 'baby';
	for (let i = 0; i < count && uiMode === 'baby'; i++) {
		await page.goto(`${base}/switch`);
		await page.locator('[data-testid^="child-select-"]').nth(i).click();
		await page.waitForURL(/\/(baby|preschool|elementary|junior|senior)\/home$/);
		uiMode = new URL(page.url()).pathname.split('/')[1] ?? 'baby';
	}
	if (uiMode === 'baby') throw new Error('履歴ページを持つ child が見つかりませんでした');

	await page.goto(`${base}/${uiMode}/history`);
	await page.waitForURL(new RegExp(`/${uiMode}/history$`));
	// 活動タブ (日付見出しでグルーピングされる側) の描画完了を待つ
	await page.locator('[role="tablist"]').first().waitFor({ state: 'visible' });
	await capture('がんばり履歴 — 日付見出しのグルーピング (JST 暦日)');
};
