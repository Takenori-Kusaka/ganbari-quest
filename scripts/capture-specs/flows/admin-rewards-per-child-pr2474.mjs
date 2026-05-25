/**
 * scripts/capture-specs/flows/admin-rewards-per-child-pr2474.mjs
 *
 * PR #2474 (#2362 PR-4): admin/rewards per-child UX SS フロー
 *
 * PR-3 #2455 admin-activities-per-child-pr2455.mjs と同型 pattern。
 *
 * 撮影 4 状態:
 *   1. default state (子供タブ + 選択 child の reward 一覧)
 *   2. 2nd child タブ切替後 (URL ?childId 同期 + active タブの aria-selected="true" 確認)
 *   3. ?import=<presetId> → ChildSelectionDialog auto-open (AC5)
 *   4. 「他の子供から copy」 dialog open (AC6)
 *
 * 設計原則 (PR #2474 Round 2 must-3 / QM-must-2 対応):
 *   - `.catch(() => {})` で UI 動作失敗を SS に偽装しない (PR-3 Round 5 教訓 / ADR-0006)
 *   - 各 step で必須の状態遷移を明示 wait (失敗時は throw → capture 全体 fail)
 *   - SS-02 は SS-01 と differ することを期待: 2 番目タブが active になっていること
 *   - SS-04 は SS-01 と differ することを期待: copy dialog が visible になっていること
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
 * 指定 child tab が active 状態 (aria-selected="true") になるまで待つ。
 * 失敗時は throw → capture 全体 fail (SS 偽装防止、PR #2474 Round 2 must-3)。
 */
async function waitForChildTabActive(page, childId) {
	await page.waitForFunction(
		(id) => {
			const el = document.querySelector(`[data-testid="rewards-child-tab-${id}"]`);
			return el?.getAttribute('aria-selected') === 'true';
		},
		childId,
		{ timeout: 5_000, polling: 100 },
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

	// --- 2) 2 child 目に切替 (URL 同期 + 一覧切替 + active タブ反映確認) ---
	// PR #2474 Round 2 must-3: クリック後に aria-selected="true" を明示 wait。
	// 旧版は単に rAF 待ちのみで、UI 上タブ切替が反映されていない状態を撮影していた (SS-02 == SS-01)。
	const tabs = page.locator('[data-testid^="rewards-child-tab-"]');
	const tabCount = await tabs.count();
	if (tabCount < 2) {
		throw new Error(
			`[capture] admin-rewards: child タブが 2 件以上必要 (got ${tabCount}). ` +
				`global-setup / demo-data seed 確認。`,
		);
	}
	const secondTab = tabs.nth(1);
	const secondTabTestId = await secondTab.getAttribute('data-testid');
	const secondChildId = secondTabTestId?.replace('rewards-child-tab-', '');
	if (!secondChildId) {
		throw new Error('[capture] admin-rewards: 2 番目タブの data-testid から childId を抽出できず');
	}
	await secondTab.click();
	// active タブが切替わるまで wait (UI 状態遷移完了を assert)
	await waitForChildTabActive(page, secondChildId);
	// child context banner の child name update 待ち (rAF + paint)
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr2474-admin-rewards-child-tab-switched');

	// --- 3) ?import=<presetId> → ChildSelectionDialog auto-open ---
	// marketplace SSOT に存在する reward-set id を渡す
	// PR #2474 Round 2 must-3: dialog open 失敗時は throw (撮影継続しない)。
	await page.goto(`${BASE_URL}/admin/rewards?import=kinder-rewards&screenshot=all`);
	await waitForDialogOpen(page, 'reward-import-child-selection-dialog');
	await capture('pr2474-admin-rewards-import-dialog-auto-open');
	// Esc で閉じる (後続 step に影響しないように)
	await page.keyboard.press('Escape');

	// --- 4) 「他の子供から copy」 dialog open ---
	// PR #2474 Round 2 must-3: copy dialog open を必須 wait。失敗時は throw (SS 偽装防止)。
	// 旧版は `.catch(() => {})` で waitForDialogOpen 失敗を握りつぶし、SS-01 と同一の画面を
	// SS-04 として保存していた (file 名 `-attempted` 接尾辞が偽装の自認)。
	await page.goto(`${BASE_URL}/admin/rewards?screenshot=all`);
	await page.getByTestId('admin-rewards-child-tabs').waitFor({ state: 'visible', timeout: 15_000 });
	const copyBtn = page.getByTestId('rewards-copy-from-child-btn');
	const copyBtnCount = await copyBtn.count();
	if (copyBtnCount === 0) {
		throw new Error(
			'[capture] admin-rewards: rewards-copy-from-child-btn 未表示 (children 2 件以上 + premium 確認)。',
		);
	}
	await copyBtn.click();
	await waitForDialogOpen(page, 'rewards-copy-from-child-dialog');
	await capture('pr2474-admin-rewards-copy-dialog');
};
