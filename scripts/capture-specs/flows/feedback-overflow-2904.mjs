/**
 * scripts/capture-specs/flows/feedback-overflow-2904.mjs
 *
 * #2904: 右下常設 FeedbackFab の撤去 + フィードバック導線 = 設定 > サポート単独 SSOT の SS。
 * (PO 判断: 「各ページには不要。設定>サポートにあればOK。」 — ︙ overflow への
 *  「ご意見を送る」item は不採用)
 *
 * - admin/activities 一覧: 右下 FAB が存在しない (撤去後の after 状態)
 * - activities の ︙ overflow を user-gesture で展開し、「ご意見を送る」item が
 *   存在しない (補助操作のみ) 状態を撮る
 * - 設定 > サポート (/admin/settings/support): ご意見フォーム SSOT (唯一の導線)
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
	// Ark UI Menu は hydration 後に listener attach するため、open になるまで rAF 間隔で再 click
	// (tests/e2e の openMenu helper / #2260 Fix-6 と同型)
	const MAX_ATTEMPTS = 30;
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		await btn.click();
		const state = await btn.evaluate((el) => el.getAttribute('aria-expanded'));
		if (state === 'true') break;
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
		);
	}
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

	// --- 2) activities ︙ overflow 展開 (「ご意見を送る」item が無い = 補助操作のみ) ---
	await waitForMenuOpen(page, 'header-overflow-menu-btn');
	await page.getByTestId('menu-item-restore').waitFor({ state: 'visible', timeout: 5_000 });
	const feedbackItemCount = await page.getByTestId('menu-item-feedback').count();
	if (feedbackItemCount > 0) {
		throw new Error(
			'#2904: ︙ overflow に「ご意見を送る」item が残存しています (設定 > サポート単独 SSOT 違反)',
		);
	}
	await capture('issue-2904-activities-overflow-no-feedback');
	await page.keyboard.press('Escape');

	// --- 3) 唯一の導線: 設定 > サポート (ご意見フォーム SSOT) ---
	await page.goto(`${BASE_URL}/admin/settings/support?screenshot=all`);
	await page
		.locator('[data-tutorial="feedback-section"]')
		.waitFor({ state: 'visible', timeout: 15_000 });
	await capture('issue-2904-settings-support-form');
};
