/**
 * scripts/capture-specs/flows/admin-activities-per-child-pr2455.mjs
 *
 * PR #2455 (#2362 PR-3 Phase 4): admin/activities per-child UX SS フロー
 *
 * 撮影 5+ 状態:
 *   1. default state (子供タブ + family master 一覧)
 *   2. 2nd child タブ切替後
 *   3. ?import=<presetId> → ChildSelectionDialog auto-open
 *   4. 「他の子供から copy」 dialog open
 *   5. 「一括追加」 dialog open
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 node scripts/capture.mjs \
 *     --flow admin-activities-per-child-pr2455 \
 *     --url /admin/activities?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-activities-per-child-pr2455.mjs \
 *     --presets desktop,mobile \
 *     --pr 2455
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

/** open dialog 待ち (Ark UI Dialog Portal — data-state="open" polling、hidden 解除も待つ) */
async function waitForDialogOpen(page, testid) {
	// Ark UI Dialog の Portal は body 末尾に配置 + bind:open の reactivity 反映に
	// 数 frame かかるため polling で確実に待つ
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
	// transition 完了待ち
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
	// --- 1) default state: 子供タブ row + family master 一覧 ---
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page
		.getByTestId('admin-activities-child-tabs')
		.waitFor({ state: 'visible', timeout: 15_000 });
	await capture('pr2455-admin-activities-default');

	// --- 2) 2 child 目に切替 (URL 同期 + 一覧切替) ---
	const tabs = page.locator('[data-testid^="child-tab-"]');
	const tabCount = await tabs.count();
	if (tabCount >= 2) {
		await tabs.nth(1).click();
		// child context banner update 待ち
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);
		await capture('pr2455-admin-activities-child-tab-switched');
	}

	// --- 3) ?import=<presetId> → ChildSelectionDialog auto-open ---
	// marketplace SSOT に存在する activity-pack id を渡す
	await page.goto(`${BASE_URL}/admin/activities?import=simple-daily&screenshot=all`);
	await waitForDialogOpen(page, 'import-child-selection-dialog');
	await capture('pr2455-admin-activities-import-dialog-auto-open');
	// Esc で閉じる
	await page.keyboard.press('Escape');

	// --- 4) 「他の子供から copy」 dialog open ---
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page
		.getByTestId('admin-activities-child-tabs')
		.waitFor({ state: 'visible', timeout: 15_000 });
	const copyBtn = page.getByTestId('copy-from-child-btn');
	const copyBtnVisible = (await copyBtn.count()) > 0 && (await copyBtn.isVisible());
	if (copyBtnVisible) {
		// 通常 click → Svelte 5 hydration + Ark UI Dialog state 反映を確実に待つ
		await copyBtn.dispatchEvent('click');
		// Ark UI Dialog hydration + reactivity の安定化を多段で待つ
		await page.waitForTimeout(1200);
		// DOM 確認 (button click が svelte state を変化させているか)
		const copyDialogState = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="copy-from-child-dialog"]');
			return {
				exists: !!el,
				state: el?.getAttribute('data-state'),
				hidden: el?.hasAttribute('hidden'),
			};
		});
		console.log('[capture] copy-from-child-dialog state:', copyDialogState);
		await capture('pr2455-admin-activities-copy-dialog-attempted');
		await page.keyboard.press('Escape').catch(() => {});
		await page.waitForTimeout(500);
	}

	// --- 5) 「一括追加」 dialog open ---
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page
		.getByTestId('admin-activities-child-tabs')
		.waitFor({ state: 'visible', timeout: 15_000 });
	const bulkBtn = page.getByTestId('bulk-create-btn');
	if ((await bulkBtn.count()) > 0) {
		await bulkBtn.click({ force: true });
		await page.waitForTimeout(800);
		const bulkDialogState = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="bulk-create-dialog"]');
			return {
				exists: !!el,
				state: el?.getAttribute('data-state'),
				hidden: el?.hasAttribute('hidden'),
			};
		});
		console.log('[capture] bulk-create-dialog state:', bulkDialogState);
		await capture('pr2455-admin-activities-bulk-create-attempted');
	}
};
