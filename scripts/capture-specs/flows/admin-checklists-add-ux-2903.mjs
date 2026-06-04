/**
 * scripts/capture-specs/flows/admin-checklists-add-ux-2903.mjs
 *
 * #2903 (EPIC #2897): checklist 管理の add UI を activities (ActivitiesHeader) と同型に統一する SS。
 * 旧実装は AI 提案パネルがページ本文に直接露出していたが、本 PR で「+ 追加」dropdown 内の
 * 選択肢 (手動 / AI / みんなのテンプレートから探す / ワンオフ) に格納し、activities と操作の入口を
 * 揃えた (PO 指摘 #6b)。
 *
 * 本番ルート `/admin/checklists` を demo Lambda 同型 env (AUTH_MODE=anonymous + DATA_SOURCE=demo)
 * で起動した dev server 上で開き、user-gesture で「+ 追加」dropdown / AI ダイアログを展開した状態を撮る。
 * `admin-activities-add-ux-2260.mjs` と同型のフロー。
 *
 * 使用例 (BASE_URL は demo Lambda env で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-checklists-add-ux-2903 \
 *     --url /admin/checklists?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-checklists-add-ux-2903.mjs \
 *     --presets desktop,mobile \
 *     --pr 2903
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** Ark UI Menu hydration 完了 + open 状態確立を待つ helper (add-ux-2260 と同型) */
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
	// --- 1) 通常一覧 (default state: AI パネル直置きが撤去され、header + 一覧のみ) ---
	await page.goto(`${BASE_URL}/admin/checklists?screenshot=all`);
	await page.getByTestId('admin-checklists-page').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('issue-2903-admin-checklists-default');

	// --- 2) 「+ 追加」dropdown 展開 (手動 / AI / みんなのテンプレートから探す / ワンオフ) ---
	await waitForMenuOpen(page, 'checklists-add-menu');
	await capture('issue-2903-admin-checklists-add-menu-open');
	await page.keyboard.press('Escape');
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="checklists-add-menu"]')?.getAttribute('aria-expanded') ===
			'false',
		undefined,
		{ timeout: 3_000 },
	);

	// --- 3) 「+ 追加 → AI」で AI 提案ダイアログを開いた状態 (activities の add → ai と同型) ---
	await waitForMenuOpen(page, 'checklists-add-menu');
	await page.getByTestId('menu-item-ai').click();
	await page
		.getByTestId('checklists-ai-dialog')
		.waitFor({ state: 'visible', timeout: 5_000 });
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('issue-2903-admin-checklists-ai-dialog-open');
};
