/**
 * scripts/capture-specs/flows/admin-activities-add-ux-2260.mjs
 *
 * PR #2260 QM Tier 2 Fix-5: AC2 SS 3 状態 (menu 展開 / overflow 展開 / empty state)
 * を撮影するためのフロー。本番ルート `/admin/activities` を demo Lambda 同型 env で起動した
 * dev server 上で開き、user-gesture で menu / overflow を展開した状態を撮る。empty state は
 * 全活動を hidden 化することで再現。
 *
 * 使用例 (BASE_URL は demo Lambda env で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-activities-add-ux-2260 \
 *     --url /admin/activities?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-activities-add-ux-2260.mjs \
 *     --presets desktop,mobile \
 *     --pr 2260
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** Ark UI Menu hydration 完了 + open 状態確立を待つ helper */
async function waitForMenuOpen(page, triggerTestId) {
	const btn = page.getByTestId(triggerTestId);
	// Ark UI の event handler 登録が完了するまで hydration を待つ
	// (aria-expanded="false" が SSR から確定するまで)
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	// hydration buffer (event handler 登録待ち、Ark UI 5.x で必要)
	await page.waitForFunction(
		(testid) => {
			const el = document.querySelector(`[data-testid="${testid}"]`);
			return el?.getAttribute('aria-expanded') === 'false';
		},
		triggerTestId,
		{ timeout: 10_000 },
	);
	await btn.click();
	// open 状態を polling で待つ
	await page.waitForFunction(
		(testid) => {
			const el = document.querySelector(`[data-testid="${testid}"]`);
			return el?.getAttribute('aria-expanded') === 'true';
		},
		triggerTestId,
		{ timeout: 5_000 },
	);
	// menu animation 完了待ち
	await page.waitForTimeout(300);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) 通常一覧 (default state: + 追加 + ︙ の 2 要素 header) ---
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page
		.getByTestId('header-add-activity-btn')
		.waitFor({ state: 'visible', timeout: 15_000 });
	await capture('epic-2253-admin-activities-default');

	// --- 2) + 追加 dropdown menu 展開 (manual / ai / import 3 menu item) ---
	await waitForMenuOpen(page, 'header-add-activity-btn');
	await capture('epic-2253-admin-activities-add-menu-open');
	// close menu (Esc + animation buffer)
	await page.keyboard.press('Escape');
	await page.waitForTimeout(500);

	// --- 3) ︙ overflow menu 展開 (introduce / export / clear-all) ---
	await waitForMenuOpen(page, 'header-overflow-menu-btn');
	await capture('epic-2253-admin-activities-overflow-open');
	await page.keyboard.press('Escape');
	await page.waitForTimeout(500);

	// --- 4) empty state ---
	// 注: empty state は dev fixture が 115 件 seed されており、`page.route()` で
	// `__data.json` を intercept する方式は SvelteKit dev SSR (inline data hydration)
	// では効かない (network 経由の data fetch が発生しないため)。
	// 代わりに JS で client-side state を直接 mutate する DOM 操作で empty 再現を試みる。
	// それでも不可能な場合は Storybook `ActivityEmptyState.stories.svelte` 3 variants で
	// 視覚カバー、E2E spec `tests/e2e/admin-activities-add-ux.spec.ts` で挙動カバー。
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page
		.getByTestId('header-add-activity-btn')
		.waitFor({ state: 'visible', timeout: 15_000 });
	// 検索フィルタで全件除外 → ActivityEmptyState (filter 経由) を表示
	// (filter 経由の empty では `empty-state-import-link` は出ないが、no-results UI は確認可能)
	const searchInput = page.locator('input[id="activity-search"]');
	if ((await searchInput.count()) > 0) {
		await searchInput.fill('___zzz_no_match_filter___');
		await page.waitForTimeout(800);
		await capture('epic-2253-admin-activities-empty-state-filter');
	}
};
