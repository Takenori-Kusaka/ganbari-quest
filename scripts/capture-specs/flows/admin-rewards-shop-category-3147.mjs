/**
 * scripts/capture-specs/flows/admin-rewards-shop-category-3147.mjs
 *
 * #3147: ごほうび登録フォームに「ショップの並び（タブ）」セレクトを追加した SS。
 * 登録カテゴリ (RewardCategory 6 値) とは独立した陳列系統 (physical/money/privilege)
 * を親が登録時に選べるようにし、未選択 (自動で振り分け) のときだけ表示側
 * deriveShopCategory に fallback する 2 段構え (列優先 + null fallback)。
 *
 * 本番ルート `/admin/rewards` を demo Lambda 同型 env (AUTH_MODE=anonymous +
 * DATA_SOURCE=demo) で起動した dev server 上で開く。`?plan=family` で premium
 * gate を解除し (デモ既定は free)、`?screenshot=all` で demo 固有 UI を抑止する。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-rewards-shop-category-3147 \
 *     --url "/admin/rewards?plan=family&screenshot=all" \
 *     --actions scripts/capture-specs/flows/admin-rewards-shop-category-3147.mjs \
 *     --presets desktop,mobile --pr 3147
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const ENTRY = '/admin/rewards?plan=family&screenshot=all';

/**
 * Ark UI Menu trigger を click し、portal 内の指定 menu-item が visible になるまで待つ。
 * Svelte 5 hydration race を click retry (最大 5 回) で吸収する。
 */
async function openMenuAndWaitItem(page, triggerTestId, itemTestId) {
	const btn = page.getByTestId(triggerTestId);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	const item = page.getByTestId(itemTestId);
	for (let attempt = 0; attempt < 5; attempt++) {
		await btn.click();
		try {
			await item.waitFor({ state: 'visible', timeout: 2_000 });
			await page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
					),
			);
			return;
		} catch {
			// hydration race / 再 click で吸収
		}
	}
	await item.waitFor({ state: 'visible', timeout: 3_000 });
}

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
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) 通常一覧 (premium 解除済、ごほうび管理ヘッダー + per-child 一覧) ---
	await page.goto(`${BASE_URL}${ENTRY}`);
	await page.getByTestId('admin-rewards-list').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('issue-3147-admin-rewards-list');

	// --- 2) 「+ 追加」dropdown → 「手動で1つ追加」で登録 dialog を開く ---
	await openMenuAndWaitItem(page, 'rewards-add-menu', 'menu-item-manual');
	await page.getByTestId('menu-item-manual').click();
	await waitForDialogOpen(page, 'rewards-add-dialog');

	// dialog 上部はプリセット選択グリッド。新規セレクトは下部の登録フォーム内にあるため、
	// フォーム (title / points / icon / category / shopCategory) を埋めて見える位置までスクロールする。
	await page.getByTestId('rewards-add-dialog').locator('input[name="title"]').fill('ゲーム30分');
	const shopSelect = page.locator('[data-testid="rewards-add-dialog"] select[name="shopCategory"]');
	await shopSelect.waitFor({ state: 'attached', timeout: 5_000 });
	await shopSelect.scrollIntoViewIfNeeded();
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('issue-3147-admin-rewards-add-dialog');

	// --- 3) 「ショップの並び（タブ）」セレクトで privilege (とくべつ) を選んだ状態 ---
	await shopSelect.selectOption('privilege');
	await shopSelect.scrollIntoViewIfNeeded();
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('issue-3147-admin-rewards-shop-category-selected');
};
