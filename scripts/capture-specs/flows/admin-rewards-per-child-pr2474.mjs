/**
 * scripts/capture-specs/flows/admin-rewards-per-child-pr2474.mjs
 *
 * PR #2474 (#2362 PR-4): admin/rewards per-child UX SS フロー
 *
 * PR-3 #2455 admin-activities-per-child-pr2455.mjs と同型 pattern。
 *
 * 撮影 4 状態:
 *   1. default state (子供タブ + 選択 child の reward 一覧)
 *   2. 2nd child タブ切替後 (URL ?childId 同期)
 *   3. ?import=<presetId> → ChildSelectionDialog auto-open (AC5)
 *   4. 「他の子供から copy」 dialog open (AC6)
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 node scripts/capture.mjs \
 *     --flow admin-rewards-per-child-pr2474 \
 *     --url /admin/rewards?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-rewards-per-child-pr2474.mjs \
 *     --presets desktop,mobile \
 *     --pr 2474
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

/** open dialog 待ち (Ark UI Dialog Portal — data-state="open" polling、hidden 解除も待つ) */
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
	// --- 1) default state: 子供タブ row + reward 一覧 ---
	await page.goto(`${BASE_URL}/admin/rewards?screenshot=all`);
	await page.getByTestId('admin-rewards-child-tabs').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('pr2474-admin-rewards-default');

	// --- 2) 2 child 目に切替 (URL 同期 + 一覧切替) ---
	const tabs = page.locator('[data-testid^="rewards-child-tab-"]');
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
		await capture('pr2474-admin-rewards-child-tab-switched');
	}

	// --- 3) ?import=<presetId> → ChildSelectionDialog auto-open ---
	// marketplace SSOT に存在する reward-set id を渡す
	await page.goto(`${BASE_URL}/admin/rewards?import=kinder-rewards&screenshot=all`);
	await waitForDialogOpen(page, 'reward-import-child-selection-dialog').catch(() => {
		// dialog が hydration されない場合でも撮影は試みる
	});
	await capture('pr2474-admin-rewards-import-dialog-auto-open');
	// Esc で閉じる
	await page.keyboard.press('Escape').catch(() => {});

	// --- 4) 「他の子供から copy」 dialog open ---
	await page.goto(`${BASE_URL}/admin/rewards?screenshot=all`);
	await page.getByTestId('admin-rewards-child-tabs').waitFor({ state: 'visible', timeout: 15_000 });
	const copyBtn = page.getByTestId('rewards-copy-from-child-btn');
	const copyBtnVisible = (await copyBtn.count()) > 0 && (await copyBtn.isVisible());
	if (copyBtnVisible) {
		await copyBtn.dispatchEvent('click');
		await waitForDialogOpen(page, 'rewards-copy-from-child-dialog').catch(() => {
			// dialog が hydration されない場合 (per-child 機能未活性等) でも撮影は試みる
		});
		const copyDialogState = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="rewards-copy-from-child-dialog"]');
			return {
				exists: !!el,
				state: el?.getAttribute('data-state'),
				hidden: el?.hasAttribute('hidden'),
			};
		});
		console.log('[capture] rewards-copy-from-child-dialog state:', copyDialogState);
		await capture('pr2474-admin-rewards-copy-dialog-attempted');
	}
};
