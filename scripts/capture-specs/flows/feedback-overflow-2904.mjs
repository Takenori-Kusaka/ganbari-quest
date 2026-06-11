/**
 * scripts/capture-specs/flows/feedback-overflow-2904.mjs
 *
 * #2904: 右下常設 FeedbackFab の撤去 + ︙ overflow menu 末尾「ご意見を送る」導線の SS。
 *
 * - admin/activities 一覧: 右下 FAB が存在しない (撤去後の after 状態)
 * - activities / rewards / checklists の ︙ overflow を user-gesture で展開し、
 *   末尾に標準「ご意見を送る」item (AdminResourceHeader 自動 append) が見える状態を撮る
 * - 設定 > サポート (/admin/settings/support): ご意見フォーム SSOT (遷移先)
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow feedback-overflow-2904 \
 *     --url /admin/activities?screenshot=all \
 *     --actions scripts/capture-specs/flows/feedback-overflow-2904.mjs \
 *     --presets desktop,mobile \
 *     --pr <N>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** Ark UI Menu hydration 完了 + open 状態確立を待つ helper (add-ux-2260 / 2903 と同型) */
async function waitForMenuOpen(page, triggerTestId) {
	const btn = page.getByTestId(triggerTestId);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		(testid) => {
			const el = document.querySelector(`[data-testid="${testid}"]`);
			return el?.getAttribute('aria-expanded') === 'false';
		},
		triggerTestId,
		{ timeout: 10_000 },
	);
	await btn.click();
	await page.waitForFunction(
		(testid) => {
			const el = document.querySelector(`[data-testid="${testid}"]`);
			return el?.getAttribute('aria-expanded') === 'true';
		},
		triggerTestId,
		{ timeout: 5_000 },
	);
	await page
		.locator('[data-part="content"][data-state="open"]')
		.first()
		.waitFor({ state: 'attached', timeout: 3_000 })
		.catch(() => {});
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
	// --- 1) activities 一覧 (after: 右下 FeedbackFab が存在しない) ---
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page.getByTestId('header-add-activity-btn').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('issue-2904-admin-activities-no-fab');

	// --- 2) activities ︙ overflow 展開 (末尾に「ご意見を送る」) ---
	await waitForMenuOpen(page, 'header-overflow-menu-btn');
	await page.getByTestId('menu-item-feedback').waitFor({ state: 'visible', timeout: 5_000 });
	await capture('issue-2904-activities-overflow-feedback');
	await page.keyboard.press('Escape');

	// --- 3) rewards ︙ overflow (overflowSnippet 経路にも末尾 append) ---
	await page.goto(`${BASE_URL}/admin/rewards?screenshot=all`);
	await waitForMenuOpen(page, 'rewards-overflow-menu');
	await page.getByTestId('menu-item-feedback').waitFor({ state: 'visible', timeout: 5_000 });
	await capture('issue-2904-rewards-overflow-feedback');
	await page.keyboard.press('Escape');

	// --- 4) checklists ︙ overflow (OverflowMenu primitive 経路にも末尾 append) ---
	await page.goto(`${BASE_URL}/admin/checklists?screenshot=all`);
	await waitForMenuOpen(page, 'checklists-overflow-menu');
	await page
		.getByTestId('overflow-menu-item-feedback')
		.waitFor({ state: 'visible', timeout: 5_000 });
	await capture('issue-2904-checklists-overflow-feedback');
	await page.keyboard.press('Escape');

	// --- 5) 遷移先: 設定 > サポート (ご意見フォーム SSOT) ---
	await page.goto(`${BASE_URL}/admin/settings/support?screenshot=all`);
	await page
		.locator('[data-tutorial="feedback-section"]')
		.waitFor({ state: 'visible', timeout: 15_000 });
	await capture('issue-2904-settings-support-form');
};
