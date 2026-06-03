/**
 * scripts/capture-specs/flows/admin-empty-states-dor.mjs
 *
 * CX-DoR #9・#11 (Round 18): 5 admin page empty state を UnifiedEmptyState SSOT に統一した
 * 視覚証跡。reliably 再現可能な filter-empty (rewards 検索 0 件) を撮影する。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 node scripts/capture.mjs \
 *     --flow admin-empty-states-dor \
 *     --url /admin/rewards?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-empty-states-dor.mjs \
 *     --presets desktop,mobile \
 *     --pr 2804
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// rewards 検索 0 件 → allEmpty → UnifiedEmptyState (hasFilter mode) 表示
	await page.goto(`${BASE_URL}/admin/rewards?screenshot=all`);
	// 検索 input を表示まで待つ
	const search = page.locator('input[type="search"]').first();
	await search.waitFor({ state: 'visible', timeout: 15_000 });
	// マッチしない検索語を入力 (allEmpty 発火)
	await search.fill('zzzznomatch検索語zzzz');
	// UnifiedEmptyState (rewards-search-empty testid) が visible になるまで wait。
	// 失敗時は throw → capture 全体 fail (SS 偽装防止、ADR-0006)。
	const emptyState = page.getByTestId('rewards-search-empty');
	await emptyState.waitFor({ state: 'visible', timeout: 10_000 });
	// empty state を画面内にスクロール (page 下端のため)
	await emptyState.scrollIntoViewIfNeeded();
	// transition / paint 完了待ち
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('dor-rewards-search-empty');
};
