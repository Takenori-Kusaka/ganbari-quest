/**
 * scripts/capture-specs/flows/admin-rewards-edit-shop-category-3154.mjs
 *
 * #3154: ごほうび編集 dialog に「ショップの並び（タブ）」セレクト (shop_category) を追加した SS。
 * 登録 (add) でのみ設定可だった陳列系統を、登録後の編集でも変更可能にした (#3147 / #3150 の edit 配線)。
 *
 * 本番ルート `/admin/rewards` を demo Lambda 同型 env (AUTH_MODE=anonymous + DATA_SOURCE=demo) で
 * 起動した dev server 上で開く。`?plan=family` で premium gate を解除し、`?screenshot=all` で
 * demo 固有 UI を抑止する。既存の admin-rewards-shop-category-3147 flow (add 側) の edit 版。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-rewards-edit-shop-category-3154 \
 *     --url "/admin/rewards?plan=family&screenshot=all" \
 *     --actions scripts/capture-specs/flows/admin-rewards-edit-shop-category-3154.mjs \
 *     --presets desktop,mobile --pr 3154
 */

async function waitForDialogOpen(page, testid) {
	await page.waitForFunction(
		(t) => {
			const el = document.querySelector(`[data-testid="${t}"]`);
			return !!el && el.getAttribute('data-state') === 'open' && !el.hasAttribute('hidden');
		},
		testid,
		{ timeout: 5_000, polling: 100 },
	);
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * 編集ボタン (reward-edit-btn-<id>) を click → 編集 dialog が open になるまで Svelte 5 hydration race を
 * click retry (最大 5 回) で吸収する。
 */
async function openEditDialogWithRetry(page, editBtn) {
	for (let attempt = 0; attempt < 5; attempt++) {
		await editBtn.click();
		try {
			await waitForDialogOpen(page, 'reward-edit-dialog');
			return;
		} catch {
			// hydration race / 再 click で吸収
		}
	}
	await waitForDialogOpen(page, 'reward-edit-dialog');
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) ごほうび一覧 (premium 解除済) ---
	// capture recorder (screenshot-helpers.mjs) が既に --url へ navigate 済のため、ここでは
	// 二重 goto しない (二重 navigation は `?screenshot=all` で ERR_ABORTED の race を起こす)。
	await page.getByTestId('admin-rewards-list').waitFor({ state: 'visible', timeout: 15_000 });

	// 子供タブを順に選び、ごほうびを持つ (= reward-edit-btn が出る) 子を見つける。
	// demo データは子ごとに 0〜5 件 (先頭の子は空のことがある) のため、空でないタブを探す。
	const childTabs = page.locator('[data-testid^="rewards-child-tab-"]');
	const tabCount = await childTabs.count();
	for (let i = 0; i < Math.max(tabCount, 1); i++) {
		if (i < tabCount) {
			await childTabs.nth(i).click();
			// per-child rewards の derived 再描画を待つ (rAF だけだと描画前に count を読む)
			await page
				.locator('[data-testid^="reward-edit-btn-"]')
				.first()
				.waitFor({ state: 'visible', timeout: 2_500 })
				.catch(() => {});
		}
		if ((await page.locator('[data-testid^="reward-edit-btn-"]').count()) > 0) break;
	}

	// --- 2) 一覧の先頭ごほうびの「編集」ボタンを押して編集 dialog を開く ---
	const firstEditBtn = page.locator('[data-testid^="reward-edit-btn-"]').first();
	await firstEditBtn.waitFor({ state: 'visible', timeout: 15_000 });
	await openEditDialogWithRetry(page, firstEditBtn);

	// 編集 dialog 下部の「ショップの並び（タブ）」セレクトが見える位置までスクロール
	const shopSelect = page.locator(
		'[data-testid="reward-edit-dialog"] select[name="shopCategory"]',
	);
	await shopSelect.waitFor({ state: 'attached', timeout: 5_000 });
	await shopSelect.scrollIntoViewIfNeeded();
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('issue-3154-admin-rewards-edit-dialog');

	// --- 3) 「ショップの並び（タブ）」で money (お小遣い) を選んだ状態 ---
	await shopSelect.selectOption('money');
	await shopSelect.scrollIntoViewIfNeeded();
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('issue-3154-admin-rewards-edit-shop-category-selected');
};
