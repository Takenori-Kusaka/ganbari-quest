/**
 * scripts/capture-specs/flows/admin-reward-delete-keeps-history-4683.mjs (#4683)
 *
 * 「交換済みのごほうびを削除しても交換履歴が残る」ことを撮る SS フロー。
 *   1. /admin/rewards の削除ダイアログ (不可逆 note の文言)
 *   2. 削除後の親の承認履歴 (/admin/rewards/requests)
 *   3. 削除後の子供の交換履歴 (/<uiMode>/history?kind=purchases)
 *
 * develop (修正前) でも同じ file を渡して before SS を撮れるよう、存在しない要素には触れず
 * 失敗しても続行する。撮影前に対象ごほうび + 承認済み交換 + 台帳の控除を seed しておくこと
 * (seed は本 file の責務外 — before / after で同一状態から撮るため呼び出し側が用意する)。
 *
 * 使用例 (AUTH_MODE=local の dev server、専用 port):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5199 node scripts/capture.mjs \
 *     --flow admin-reward-delete-keeps-history-4683 \
 *     --url /admin/rewards \
 *     --actions scripts/capture-specs/flows/admin-reward-delete-keeps-history-4683.mjs \
 *     --presets mobile \
 *     --base-url http://localhost:5199 \
 *     --out tmp/screenshots/pr-<N>/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** seed 側と合わせる対象ごほうびのタイトル (env で上書き可)。 */
const TARGET_TITLE = process.env.SS_REWARD_TITLE || 'おこづかい 100えん';

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

/**
 * Ark UI Dialog の trigger を hydration 完了まで再試行 click する。
 * @param {import('playwright').Locator} trigger
 * @param {import('playwright').Locator} dialog
 */
async function openDialogWithRetry(trigger, dialog) {
	await trigger.waitFor({ state: 'visible', timeout: 20_000 });
	for (let i = 0; i < 6; i++) {
		await trigger.click().catch(() => {});
		try {
			await dialog.waitFor({ state: 'visible', timeout: 3_000 });
			return;
		} catch {
			// hydration race → 再 click
		}
	}
	await dialog.waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	await page.goto(`${BASE_URL}/admin/rewards`);
	await page.locator('[data-testid^="reward-item-"]').first().waitFor({ timeout: 30_000 });
	await dismissOverlays(page);

	// 対象ごほうびの行 → 削除ボタンの testid から reward id を取る
	const item = page
		.locator('[data-testid^="reward-item-"]')
		.filter({ hasText: TARGET_TITLE })
		.first();
	await item.waitFor({ state: 'visible', timeout: 20_000 });
	const deleteBtn = item.locator('[data-testid^="reward-delete-btn-"]').first();

	const dialog = page.getByTestId('reward-delete-dialog');
	await openDialogWithRetry(deleteBtn, dialog);
	await capture('削除ダイアログ (不可逆 note の文言)');

	await page.getByTestId('reward-delete-confirm').click();
	await dialog.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});
	await page
		.getByTestId('rewards-action-message')
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {});
	await page.evaluate(() => window.scrollTo(0, 0));
	await capture('削除後のごほうび一覧');

	// 親の承認履歴 (削除したごほうびの交換が残るか)
	await page.goto(`${BASE_URL}/admin/rewards/requests`);
	await page
		.locator('h1, h2')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	await page.evaluate(() => window.scrollTo(0, 0));
	await capture('削除後の親の承認履歴');

	// 子供の交換履歴 (同じ交換が残るか)
	await page.goto(`${BASE_URL}/switch`);
	const card = page.locator('[data-testid^="child-select-"]').first();
	await card.waitFor({ state: 'visible', timeout: 20_000 });
	for (let i = 0; i < 5; i++) {
		await card.click().catch(() => {});
		try {
			await page.waitForURL(/\/(preschool|elementary|junior|senior|baby)\//, { timeout: 8_000 });
			break;
		} catch {
			await page.goto(`${BASE_URL}/switch`);
		}
	}
	const uiMode = new URL(page.url()).pathname.split('/')[1];
	await page.goto(`${BASE_URL}/${uiMode}/history?kind=purchases`);
	await page
		.locator('[data-testid="history-list-purchases"], [data-testid="history-empty-purchases"]')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	await dismissOverlays(page);
	await page.evaluate(() => window.scrollTo(0, 0));
	await capture('削除後の子供の交換履歴');
};
