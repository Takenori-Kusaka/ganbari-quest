/**
 * scripts/capture-specs/flows/admin-rules-family-scope-pr6.mjs
 *
 * #2362 PR-6: admin/settings/rules family-scope UX SS フロー
 *
 * 撮影 4 状態:
 *   1. default state (empty + family-wide 一覧、per-child タブなし)
 *   2. OverflowMenu (top-right ⋮) open 状態
 *   3. ?import=<presetId> auto-import 完了後 (一覧に追加 + toast 表示)
 *   4. help dialog open 状態
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 node scripts/capture.mjs \
 *     --flow admin-rules-family-scope-pr6 \
 *     --url /admin/settings/rules?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-rules-family-scope-pr6.mjs \
 *     --presets desktop,mobile \
 *     --pr <PR_NUMBER>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

/** Ark UI Dialog open 完了 polling (data-state + hidden 解除) */
async function waitForDialogOpen(page, testid) {
	await page.waitForFunction(
		(t) => {
			const el = document.querySelector(`[data-testid="${t}"]`);
			if (!el) return false;
			const state = el.getAttribute('data-state');
			const hidden = el.hasAttribute('hidden');
			return state === 'open' && !hidden;
		},
		testid,
		{ timeout: 15_000, polling: 100 },
	);
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) default state: family-wide 一覧 (per-child タブなし) ---
	await page.goto(`${BASE_URL}/admin/settings/rules?screenshot=all`);
	await page.getByTestId('admin-rules-page').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('pr6-admin-rules-default');

	// --- 2) OverflowMenu ⋮ open ---
	await page.getByTestId('rules-overflow-menu').click();
	await page
		.getByTestId('overflow-menu-item-marketplace')
		.waitFor({ state: 'visible', timeout: 10_000 });
	await capture('pr6-admin-rules-overflow-open');

	// menu 閉じる (Escape) — ArkMenu Content の data-state="closed" を待つ
	await page.keyboard.press('Escape');
	await page
		.locator('[data-testid="overflow-menu-item-marketplace"]')
		.waitFor({ state: 'hidden', timeout: 5_000 });

	// --- 3) ?import=<presetId> auto-import: streak-bonus 取込 ---
	await page.goto(`${BASE_URL}/admin/settings/rules?import=streak-bonus&screenshot=all`);
	await page.getByTestId('admin-rules-page').waitFor({ state: 'visible', timeout: 15_000 });
	// auto-import 完了で preset が一覧に追加されるのを待つ
	await page
		.getByTestId('rules-bonus-preset-streak-bonus')
		.waitFor({ state: 'visible', timeout: 30_000 });
	await capture('pr6-admin-rules-after-import');

	// --- 4) help dialog open ---
	await page.getByTestId('rules-overflow-menu').click();
	await page.getByTestId('overflow-menu-item-help').waitFor({ state: 'visible', timeout: 10_000 });
	await page.getByTestId('overflow-menu-item-help').click();
	await waitForDialogOpen(page, 'rules-help-dialog');
	await capture('pr6-admin-rules-help-dialog');
};
